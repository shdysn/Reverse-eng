import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateSessionIdParam } from '../middleware/validateSession.js';
import { manifestService } from '../services/manifest.service.js';
import type { ApiResponse, ManifestScanData } from '../types/index.js';

export const scanRouter = Router();

const handleScan = asyncHandler(async (req, res) => {
  const scanData = await manifestService.scanManifest(req.params.sessionId);
  const response: ApiResponse<ManifestScanData> = {
    success: true,
    data: scanData,
  };
  res.json(response);
});

scanRouter.get('/:sessionId/scan', validateSessionIdParam(), handleScan);
scanRouter.post('/:sessionId/scan', validateSessionIdParam(), handleScan);
