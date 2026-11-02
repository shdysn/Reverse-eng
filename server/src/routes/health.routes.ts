import { Router } from 'express';
import { commandService } from '../services/command.service.js';
import { env } from '../config/env.js';
import type { HealthData, ApiResponse } from '../types/index.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  // Check tools concurrently with short timeout
  const [apktool, jadx, zipalign, apksigner, java] = await Promise.all([
    commandService.checkExecutable(env.APKTOOL_BIN, ['-version']),
    commandService.checkExecutable(env.JADX_BIN, ['-v']),
    commandService.checkExecutable(env.ZIPALIGN_BIN, ['-h']),
    commandService.checkExecutable(env.APKSIGNER_BIN, ['--version']),
    commandService.checkExecutable('java', ['-version']),
  ]);

  const tools = {
    apktool,
    jadx,
    zipalign,
    apksigner,
    java,
  };

  const toolsAvailable = apktool && java;

  const data: HealthData = {
    status: toolsAvailable ? 'healthy' : 'degraded',
    version: '1.0.0',
    node: process.version,
    tools,
    toolsAvailable,
  };

  const response: ApiResponse<HealthData> = {
    success: true,
    data,
  };

  res.json(response);
});
