import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { z } from 'zod';
import { env } from '../config/env.js';
import { ApiError } from '../utils/apiError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { sessionService } from '../services/session.service.js';
import { apkService } from '../services/apk.service.js';
import { fileService } from '../services/file.service.js';
import type { UploadInitData, UploadCompleteData, ApiResponse } from '../types/index.js';

export const uploadRouter = Router();

const uploadInitSchema = z.object({
  filename: z.string().min(1).refine((val) => val.toLowerCase().endsWith('.apk'), {
    message: 'Filename must end in .apk',
  }),
  size: z.number().int().positive().max(env.MAX_APK_BYTES, {
    message: `File size exceeds maximum permitted (${env.MAX_APK_BYTES} bytes)`,
  }),
  chunks: z.number().int().positive().max(10000, {
    message: 'Too many chunks declared',
  }),
});

// Configure multer for disk storage in session chunks directory
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    try {
      const sessionId = req.params.sessionId;
      const sessionDir = sessionService.getSessionDir(sessionId);
      cb(null, path.join(sessionDir, 'chunks'));
    } catch (err) {
      cb(err as Error, '');
    }
  },
  filename: (req, _file, cb) => {
    const chunkIndex = parseInt(req.params.chunkIndex, 10);
    if (isNaN(chunkIndex) || chunkIndex < 0) {
      return cb(new Error('Invalid chunk index'), '');
    }
    cb(null, `chunk_${chunkIndex}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: env.MAX_CHUNK_BYTES,
  },
});

// POST /api/uploads/init
uploadRouter.post(
  '/init',
  asyncHandler(async (req, res) => {
    const parsed = uploadInitSchema.parse(req.body);

    const session = await sessionService.createSession(parsed.filename, parsed.size);

    const data: UploadInitData = {
      sessionId: session.id,
      chunkSize: 8 * 1024 * 1024, // 8 MiB standard chunk size
    };

    const response: ApiResponse<UploadInitData> = {
      success: true,
      data,
    };

    res.status(201).json(response);
  })
);

// PUT /api/uploads/:sessionId/chunks/:chunkIndex
uploadRouter.put(
  '/:sessionId/chunks/:chunkIndex',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const { sessionId, chunkIndex } = req.params;
    const idx = parseInt(chunkIndex, 10);

    if (isNaN(idx) || idx < 0) {
      throw ApiError.badRequest('Invalid chunk index', 'INVALID_CHUNK_INDEX');
    }

    if (!req.file) {
      throw ApiError.badRequest("Missing multipart chunk file named 'file'", 'MISSING_FILE_FIELD');
    }

    const session = await sessionService.getSession(sessionId);
    if (!session) {
      throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }

    res.json({
      success: true,
      data: {
        sessionId,
        chunkIndex: idx,
        receivedBytes: req.file.size,
      },
    });
  })
);

// POST /api/uploads/:sessionId/complete
uploadRouter.post(
  '/:sessionId/complete',
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    const session = await sessionService.getSession(sessionId);
    if (!session) {
      throw ApiError.notFound('Session not found', 'SESSION_NOT_FOUND');
    }

    if (sessionService.isOperationActive(sessionId)) {
      throw ApiError.conflict('Session is already processing an upload or decompilation', 'SESSION_BUSY');
    }

    sessionService.setOperationActive(sessionId, 'Assembling and decompiling APK');

    try {
      const sessionDir = sessionService.getSessionDir(sessionId);
      const chunksDir = path.join(sessionDir, 'chunks');
      const inputApk = path.join(sessionDir, 'input.apk');

      await sessionService.updateStage(sessionId, 'joining');

      // 1. Read chunks directory
      const chunkFiles = await fs.readdir(chunksDir);
      if (chunkFiles.length === 0) {
        throw ApiError.badRequest('No chunks received for this session', 'NO_CHUNKS');
      }

      // Sort chunks by numeric index chunk_0, chunk_1, ...
      chunkFiles.sort((a, b) => {
        const numA = parseInt(a.replace('chunk_', ''), 10) || 0;
        const numB = parseInt(b.replace('chunk_', ''), 10) || 0;
        return numA - numB;
      });

      // 2. Stream and join chunks into input.apk
      const destStream = createWriteStream(inputApk);
      for (const chunkFile of chunkFiles) {
        const chunkPath = path.join(chunksDir, chunkFile);
        const sourceStream = createReadStream(chunkPath);
        await pipeline(sourceStream, destStream, { end: false });
      }
      destStream.end();

      // Wait for finish
      await new Promise<void>((resolve, reject) => {
        destStream.on('finish', resolve);
        destStream.on('error', reject);
      });

      // 3. Verify final size and validate APK structure
      await sessionService.updateStage(sessionId, 'validating');
      await apkService.validateApk(inputApk, session.fileSize);

      // 4. Remove temporary chunks after successful assembly
      for (const chunkFile of chunkFiles) {
        try {
          await fs.unlink(path.join(chunksDir, chunkFile));
        } catch {
          // ignore chunk unlink error
        }
      }

      // 5. Run Decompilation (apktool + jadx)
      const { partialJadx } = await apkService.decompileApk(sessionId);

      // 6. Build file tree stats
      const treeData = await fileService.getFileTree(sessionId);

      const completeData: UploadCompleteData = {
        sessionId,
        filename: session.originalFilename,
        size: session.fileSize,
        stage: 'ready',
        partialJadx,
        treeNodesCount: treeData.totalNodes,
      };

      const response: ApiResponse<UploadCompleteData> = {
        success: true,
        data: completeData,
      };

      res.json(response);
    } catch (err) {
      await sessionService.updateStage(sessionId, 'failed', (err as Error).message);
      throw err;
    } finally {
      sessionService.clearOperationActive(sessionId);
    }
  })
);
