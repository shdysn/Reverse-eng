import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateSessionIdParam } from '../middleware/validateSession.js';
import { rebuildService } from '../services/rebuild.service.js';
import type { ApiResponse, RebuildData } from '../types/index.js';

export const rebuildRouter = Router();

// POST /api/sessions/:sessionId/rebuild
rebuildRouter.post(
  '/:sessionId/rebuild',
  validateSessionIdParam(),
  asyncHandler(async (req, res) => {
    const rebuildData = await rebuildService.rebuildApk(req.params.sessionId);
    const response: ApiResponse<RebuildData> = {
      success: true,
      data: rebuildData,
    };
    res.json(response);
  })
);
