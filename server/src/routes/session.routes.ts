import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateSessionIdParam } from '../middleware/validateSession.js';
import { sessionService } from '../services/session.service.js';
import { fileService } from '../services/file.service.js';
import { manifestService } from '../services/manifest.service.js';
import { rebuildService } from '../services/rebuild.service.js';
import { packageService } from '../services/package.service.js';
import { gradleService } from '../services/gradle.service.js';
import { ApiError } from '../utils/apiError.js';
import path from 'node:path';
import fsSync from 'node:fs';
import * as archiverModule from 'archiver';
import type { ApiResponse } from '../types/index.js';

const archiver: any = (archiverModule as any).default || archiverModule;

export const sessionRouter = Router();

const fileWriteSchema = z.object({
  content: z.string(),
});

// GET /api/sessions/:sessionId - Get session metadata
sessionRouter.get(
  '/:sessionId',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const session = await sessionService.getSession(req.params.sessionId);
    res.json({
      success: true,
      data: session,
    });
  })
);

// GET /api/sessions/:sessionId/tree - Nested File Tree
sessionRouter.get(
  '/:sessionId/tree',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const treeData = await fileService.getFileTree(req.params.sessionId);
    const response: ApiResponse<typeof treeData> = {
      success: true,
      data: treeData,
    };
    res.json(response);
  })
);

// GET /api/sessions/:sessionId/file?path=relative/path - Read file
sessionRouter.get(
  '/:sessionId/file',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const targetPath = req.query.path as string;
    const fileData = await fileService.readFile(req.params.sessionId, targetPath);
    const response: ApiResponse<typeof fileData> = {
      success: true,
      data: fileData,
    };
    res.json(response);
  })
);

// PUT /api/sessions/:sessionId/file?path=relative/path - Write/Edit file
sessionRouter.put(
  '/:sessionId/file',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const targetPath = req.query.path as string;
    const { content } = fileWriteSchema.parse(req.body);
    const writeData = await fileService.writeFile(req.params.sessionId, targetPath, content);

    // If manifest was edited, re-scan manifest
    if (writeData.manifestRescanned) {
      try {
        await manifestService.scanManifest(req.params.sessionId);
      } catch (scanErr) {
        console.warn('Auto manifest scan error after save:', scanErr);
      }
    }

    const response: ApiResponse<typeof writeData> = {
      success: true,
      data: writeData,
    };
    res.json(response);
  })
);

// GET /api/sessions/:sessionId/download - Download Rebuilt Signed APK
sessionRouter.get(
  '/:sessionId/download',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const { filePath } = await rebuildService.getSignedApkPath(req.params.sessionId);

    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="rebuilt-signed.apk"');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    res.sendFile(filePath);
  })
);

// GET /api/sessions/:sessionId/download-source - Download Java & Decompiled Source Code ZIP
sessionRouter.get(
  '/:sessionId/download-source',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }
    const sessionDir = sessionService.getSessionDir(sessionId);

    const baseName = session.originalFilename
      ? session.originalFilename.replace(/\.apk$/i, '')
      : 'android-app';
    const zipName = `${baseName}-source-code.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    const archive = archiver('zip', {
      zlib: { level: 6 },
    });

    archive.on('error', (err: any) => {
      console.error('ZIP archive error:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: { message: err.message } });
      }
    });

    archive.pipe(res);

    // 1. Add Java source code (from JADX) if present
    const javaDir = path.join(sessionDir, 'java');
    if (fsSync.existsSync(javaDir)) {
      archive.directory(javaDir, 'java-src');
    }

    // 2. Add decoded resources, manifest, and smali if present
    const decodedDir = path.join(sessionDir, 'decoded');
    if (fsSync.existsSync(decodedDir)) {
      archive.directory(decodedDir, 'decompiled');
    }

    // 3. Add AI Recovered & Reconstructed source code if present
    const recoveredDir = path.join(sessionDir, 'recovered');
    if (fsSync.existsSync(recoveredDir)) {
      archive.directory(recoveredDir, 'ai-recovered-src');
    }

    await archive.finalize();
  })
);

// GET /api/sessions/:sessionId/download-gradle - Download Android Studio Gradle Project ZIP
sessionRouter.get(
  '/:sessionId/download-gradle',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    await gradleService.streamGradleProjectZip(req.params.sessionId, res);
  })
);

// GET /api/sessions/:sessionId/package-info - Get current package name and app metadata
sessionRouter.get(
  '/:sessionId/package-info',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const info = await packageService.getPackageInfo(req.params.sessionId);
    res.json({
      success: true,
      data: info,
    });
  })
);

const renamePackageSchema = z.object({
  newPackageName: z.string().min(3, 'Package name is required'),
  newAppName: z.string().optional(),
  deepRefactorSmali: z.boolean().optional(),
});

// POST /api/sessions/:sessionId/rename-package - Rename package across Manifest, apktool.yml, and optional Smali
sessionRouter.post(
  '/:sessionId/rename-package',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const parsed = renamePackageSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest(
        `Invalid package rename payload: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
        'INVALID_PACKAGE_RENAME'
      );
    }

    const result = await packageService.renamePackage(req.params.sessionId, parsed.data);
    res.json({
      success: true,
      data: result,
    });
  })
);

// DELETE /api/sessions/:sessionId - Delete session
sessionRouter.delete(
  '/:sessionId',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    await sessionService.deleteSession(req.params.sessionId);
    res.json({
      success: true,
      data: {
        deleted: true,
        sessionId: req.params.sessionId,
      },
    });
  })
);
