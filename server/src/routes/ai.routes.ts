import { Router } from 'express';
import { z } from 'zod';
import { aiService } from '../services/ai.service.js';
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
