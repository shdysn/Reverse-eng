import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateSessionIdParam } from '../middleware/validateSession.js';
import { sessionService } from '../services/session.service.js';
import { fileService } from '../services/file.service.js';
import { manifestService } from '../services/manifest.service.js';
import { rebuildService } from '../services/rebuild.service.js';
import type { ApiResponse } from '../types/index.js';

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
