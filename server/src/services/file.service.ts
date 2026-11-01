import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { TreeNode, FileTreeData, FileData, FileWriteData } from '../types/index.js';
import { sessionService } from './session.service.js';
import { resolveSafePath } from '../utils/safePath.js';
import { getFileLanguage, isBinaryFile, isImageFile, getImageMimeType } from '../utils/fileType.js';
import { ApiError } from '../utils/apiError.js';
import { env } from '../config/env.js';

const MAX_TREE_DEPTH = 10;
const MAX_TREE_NODES = 5000;

export class FileService {
  /**
   * Generates a nested file tree of the session's workspace
   */
  public async getFileTree(sessionId: string): Promise<FileTreeData> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    let totalNodes = 0;
    let truncated = false;

    const buildSubTree = async (currentDir: string, currentRelDir: string, depth: number): Promise<TreeNode[]> => {
      if (depth > MAX_TREE_DEPTH || totalNodes >= MAX_TREE_NODES) {
        if (totalNodes >= MAX_TREE_NODES) truncated = true;
        return [];
      }

      let entries;
      try {
        entries = await fs.readdir(currentDir, { withFileTypes: true });
      } catch {
        return [];
      }

      const dirs: TreeNode[] = [];
      const files: TreeNode[] = [];

      for (const entry of entries) {
        if (totalNodes >= MAX_TREE_NODES) {
          truncated = true;
          break;
        }

        // Exclude symbolic links
        if (entry.isSymbolicLink()) continue;

        const entryPath = path.join(currentDir, entry.name);
        const relPath = currentRelDir ? `${currentRelDir}/${entry.name}` : entry.name;

        // Skip internal non-code directories from root view (like chunks, or raw zip temp)
        if (depth === 0 && (entry.name === 'chunks' || entry.name === 'build' || entry.name === 'meta.json' || entry.name === 'input.apk')) {
          continue;
        }

        if (entry.isDirectory()) {
          totalNodes++;
          const children = await buildSubTree(entryPath, relPath, depth + 1);
          dirs.push({
            name: entry.name,
            path: relPath,
            type: 'directory',
            children,
          });
        } else if (entry.isFile()) {
          totalNodes++;
          let size = 0;
          try {
            const stat = await fs.stat(entryPath);
            size = stat.size;
          } catch {
            // ignore stat failure
          }

          const ext = path.extname(entry.name);
          const isImg = isImageFile(entry.name);
          const binary = isBinaryFile(entry.name) && !isImg;
          const oversized = size > env.MAX_TEXT_BYTES;
          const firstSegment = relPath.split('/')[0];
          const isUnderWritableDir =
            firstSegment === 'decoded' || firstSegment === 'java' || firstSegment === 'recovered';
          const editable = !binary && !isImg && !oversized && isUnderWritableDir;

          files.push({
            name: entry.name,
            path: relPath,
            type: 'file',
            size,
            extension: ext,
            editable,
            binary,
            isImage: isImg,
          });
        }
      }

      // Sort alphabetically, dirs first
      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));

      return [...dirs, ...files];
    };

    const tree = await buildSubTree(sessionDir, '', 0);

    return {
      sessionId,
      tree,
      truncated,
      totalNodes,
    };
  }

  /**
   * Reads a text or image file safely from the session workspace
   */
  public async readFile(sessionId: string, relativePath: string): Promise<FileData> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const { targetPath, relativePath: safeRel } = await resolveSafePath(sessionDir, relativePath, false);

    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) {
      throw ApiError.badRequest('Target path is a directory, not a file', 'IS_DIRECTORY');
    }

    if (stat.size > env.MAX_TEXT_BYTES * 5) {
      throw ApiError.payloadTooLarge(
        `File size (${stat.size} bytes) exceeds maximum preview limit`,
        'FILE_TOO_LARGE'
      );
    }

    if (isImageFile(targetPath) && !targetPath.toLowerCase().endsWith('.svg')) {
      const buffer = await fs.readFile(targetPath);
      const mimeType = getImageMimeType(targetPath);
      const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`;
      return {
        path: safeRel,
        content: dataUri,
        language: 'image',
        editable: false,
        size: stat.size,
        isImage: true,
        mimeType,
      };
    }

    if (stat.size > env.MAX_TEXT_BYTES) {
      throw ApiError.payloadTooLarge(
        `File size (${stat.size} bytes) exceeds maximum text limit (${env.MAX_TEXT_BYTES} bytes)`,
        'FILE_TOO_LARGE'
      );
    }

    if (isBinaryFile(targetPath)) {
      throw ApiError.badRequest('Binary files cannot be opened in text editor', 'BINARY_FILE');
    }

    const content = await fs.readFile(targetPath, 'utf-8');
    const language = getFileLanguage(targetPath);
    const firstSegment = safeRel.split('/')[0];
    const editable =
      firstSegment === 'decoded' || firstSegment === 'java' || firstSegment === 'recovered';
    const isSvg = targetPath.toLowerCase().endsWith('.svg');

    return {
      path: safeRel,
      content,
      language,
      editable,
      size: stat.size,
      isImage: isSvg,
      mimeType: isSvg ? 'image/svg+xml' : undefined,
    };
  }

  /**
   * Writes a text file atomically to the session workspace
   */
  public async writeFile(sessionId: string, relativePath: string, content: string): Promise<FileWriteData> {
    const sessionDir = sessionService.getSessionDir(sessionId);
    const { targetPath, relativePath: safeRel } = await resolveSafePath(sessionDir, relativePath, true);

    const byteLength = Buffer.byteLength(content, 'utf-8');
    if (byteLength > env.MAX_TEXT_BYTES) {
      throw ApiError.payloadTooLarge(
        `Content size (${byteLength} bytes) exceeds maximum text limit (${env.MAX_TEXT_BYTES} bytes)`,
        'PAYLOAD_TOO_LARGE'
      );
    }

    // Atomic write via temporary file in same directory
    const dir = path.dirname(targetPath);
    await fs.mkdir(dir, { recursive: true });
    const tempPath = path.join(dir, `.tmp_${randomUUID()}`);

    try {
      await fs.writeFile(tempPath, content, 'utf-8');
      await fs.rename(tempPath, targetPath);
    } catch (err) {
      try {
        await fs.unlink(tempPath);
      } catch {
        // ignore cleanup error
      }
      throw ApiError.internal(`Failed to atomically save file: ${(err as Error).message}`);
    }

    const isManifest = safeRel === 'decoded/AndroidManifest.xml' || safeRel.endsWith('/AndroidManifest.xml');

    return {
      path: safeRel,
      size: byteLength,
      updatedAt: new Date().toISOString(),
      manifestRescanned: isManifest,
    };
  }
}

export const fileService = new FileService();
