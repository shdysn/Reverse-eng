import { Router } from 'express';
import { z } from 'zod';
import { aiService } from '../services/ai.service.js';
import { recoveryService } from '../services/recovery.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/apiError.js';
import { ApiResponse, AiPatchResponse } from '@android-re/shared';

export const aiRouter = Router();

const patchSchema = z.object({
  filePath: z.string().min(1, 'filePath is required'),
  fileName: z.string().min(1, 'fileName is required'),
  content: z.string().min(1, 'content cannot be empty'),
  instruction: z.string().min(3, 'Instruction must be at least 3 characters long'),
  selectedSnippet: z.string().optional(),
  fileType: z.enum(['smali', 'xml', 'java', 'other']).optional(),
});

aiRouter.post(
  '/transform',
  asyncHandler(async (req, res) => {
    const parseResult = patchSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw ApiError.badRequest(
        `Invalid request: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        'INVALID_AI_REQUEST'
      );
    }

    const result = await aiService.patchFile(parseResult.data);

    const response: ApiResponse<AiPatchResponse> = {
      success: true,
      data: result,
    };

    res.json(response);
  })
);

const projectAnalyzeSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  query: z.string().min(3, 'Query must be at least 3 characters long'),
});

aiRouter.post(
  '/project-analyze',
  asyncHandler(async (req, res) => {
    const parseResult = projectAnalyzeSchema.safeParse(req.body);
    if (!parseResult.success) {
      throw ApiError.badRequest(
        `Invalid request: ${parseResult.error.errors.map((e) => e.message).join(', ')}`,
        'INVALID_PROJECT_AI_REQUEST'
      );
    }

    const result = await aiService.analyzeProject(parseResult.data);
    res.json({
      success: true,
      data: result,
    });
  })
);

/**
 * AI Source Code Recovery Endpoints
 */
aiRouter.get(
  '/recovery/audit/:sessionId',
  asyncHandler(async (req, res) => {
    const audit = await recoveryService.auditProjectArchitecture(req.params.sessionId);
    res.json({
      success: true,
      data: audit,
    });
  })
);

aiRouter.get(
  '/recovery/file/:sessionId',
  asyncHandler(async (req, res) => {
    const filePath = req.query.path as string;
    if (!filePath) {
      throw ApiError.badRequest('filePath query parameter is required', 'MISSING_FILE_PATH');
    }
    const saved = await recoveryService.getSavedRecoveryForFile(req.params.sessionId, filePath);
    res.json({
      success: true,
      data: saved,
    });
  })
);

const recoverSourceSchema = z.object({
  sessionId: z.string().min(1, 'sessionId is required'),
  filePath: z.string().min(1, 'filePath is required'),
  jobId: z.string().optional(),
  targetLanguage: z.enum(['java', 'kotlin']).optional(),
  forceReanalyze: z.boolean().optional(),
});

aiRouter.post(
  '/recovery/recover-file',
  asyncHandler(async (req, res) => {
    const parsed = recoverSourceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest(
        `Invalid recovery request: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
        'INVALID_RECOVERY_REQUEST'
      );
    }

    const result = await recoveryService.recoverFileSource(parsed.data);
    res.json({
      success: true,
      data: result,
    });
  })
);

aiRouter.post(
  '/recovery/cancel/:jobId',
  asyncHandler(async (req, res) => {
    const cancelled = recoveryService.cancelJob(req.params.jobId);
    res.json({
      success: true,
      data: { cancelled, jobId: req.params.jobId },
    });
  })
);

aiRouter.get(
  '/recovery/status/:jobId',
  asyncHandler(async (req, res) => {
    const status = recoveryService.getJobStatus(req.params.jobId);
    res.json({
      success: true,
      data: status,
    });
  })
);

const applyRecoverySchema = z.object({
  sessionId: z.string().min(1),
  filePath: z.string().min(1),
  version: z.enum(['analyzed', 'reconstructed']),
  customContent: z.string().optional(),
  acceptedSymbolIds: z.array(z.string()).optional(),
  propagateCrossFileReferences: z.boolean().optional(),
});

aiRouter.post(
  '/recovery/apply',
  asyncHandler(async (req, res) => {
    const parsed = applyRecoverySchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest(
        `Invalid apply request: ${parsed.error.errors.map((e) => e.message).join(', ')}`,
        'INVALID_APPLY_REQUEST'
      );
    }

    const result = await recoveryService.applyRecoveredSource(parsed.data);
    res.json({
      success: true,
      data: result,
    });
  })
);

const restoreOriginalSchema = z.object({
  sessionId: z.string().min(1),
  filePath: z.string().min(1),
});

aiRouter.post(
  '/recovery/restore',
  asyncHandler(async (req, res) => {
    const parsed = restoreOriginalSchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('Invalid restore request', 'INVALID_RESTORE_REQUEST');
    }

    const result = await recoveryService.restoreOriginalSource(parsed.data);
    res.json({
      success: true,
      data: result,
    });
  })
);

const batchRecoverySchema = z.object({
  sessionId: z.string().min(1),
  filePaths: z.array(z.string()).min(1),
  targetLanguage: z.enum(['java', 'kotlin']).optional(),
});

aiRouter.post(
  '/recovery/batch',
  asyncHandler(async (req, res) => {
    const parsed = batchRecoverySchema.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.badRequest('Invalid batch recovery request', 'INVALID_BATCH_REQUEST');
    }

    const result = await recoveryService.runBatchRecovery(parsed.data);
    res.json({
      success: true,
      data: result,
    });
  })
);


