import path from 'node:path';
import fs from 'node:fs/promises';
import { ApiError } from './apiError.js';

export interface SafePathResult {
  sessionRoot: string;
  targetPath: string;
  relativePath: string;
}

/**
 * Validates that a user-supplied relative path is strictly contained within the session root.
 * Rejects absolute paths, null bytes, path traversal sequences, and symbolic links escaping the root.
 */
export async function resolveSafePath(
  sessionRoot: string,
  userRelativePath: string,
  checkWritable = false
): Promise<SafePathResult> {
  if (!userRelativePath || typeof userRelativePath !== 'string') {
    throw ApiError.badRequest('File path is required', 'INVALID_PATH');
  }

  // 1. Reject null bytes
  if (userRelativePath.includes('\0')) {
    throw ApiError.badRequest('Path contains null bytes', 'INVALID_PATH');
  }

  // 2. Reject absolute paths from API input
  if (path.isAbsolute(userRelativePath) || userRelativePath.startsWith('/') || userRelativePath.startsWith('\\')) {
    throw ApiError.badRequest('Absolute paths are prohibited', 'PATH_TRAVERSAL');
  }

  // Normalize relative path
  const normalizedRelative = path.normalize(userRelativePath).replace(/^(\.\.(\/|\\|$))+/, '');
  
  // Explicit check for '..' traversal tokens
  const segments = normalizedRelative.split(/[/\\]/);
  if (segments.includes('..')) {
    throw ApiError.badRequest('Path traversal sequence detected', 'PATH_TRAVERSAL');
  }

  // Resolve absolute target path
  const resolvedSessionRoot = path.resolve(sessionRoot);
  const targetPath = path.resolve(resolvedSessionRoot, normalizedRelative);

  // 3. Containment verification using path.relative
  const rel = path.relative(resolvedSessionRoot, targetPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw ApiError.badRequest('Access outside session root is prohibited', 'PATH_TRAVERSAL');
  }

  // 4. Verify symbolic links if path exists
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) {
      const real = await fs.realpath(targetPath);
      const realRel = path.relative(resolvedSessionRoot, real);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw ApiError.forbidden('Symbolic links pointing outside session are prohibited', 'UNSAFE_SYMLINK');
      }
    }
  } catch (err: unknown) {
    // If file does not exist yet (e.g. creating/saving new file), check parent directory if needed
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code !== 'ENOENT') {
      throw err;
    }
  }

  // 5. If writing/modifying, enforce allowed directories (only decoded/ or java/)
  if (checkWritable) {
    const firstSegment = rel.split(path.sep)[0];
    const allowedWritablePrefixes = ['decoded', 'java'];
    if (!allowedWritablePrefixes.includes(firstSegment)) {
      throw ApiError.forbidden(
        `File modification is only permitted in decoded/ and java/ directories. '${firstSegment}' is read-only.`,
        'READ_ONLY_LOCATION'
      );
    }
  }

  return {
    sessionRoot: resolvedSessionRoot,
    targetPath,
    relativePath: rel.split(path.sep).join('/'),
  };
}
