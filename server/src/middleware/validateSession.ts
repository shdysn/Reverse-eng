import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/apiError.js';
import { sessionService } from '../services/session.service.js';

export const SESSION_ID_REGEX = /^[0-9a-f]{32}$/;

export function validateSessionIdParam(paramName = 'sessionId') {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const sessionId = req.params[paramName] || (req.query.sessionId as string);

      if (!sessionId || !SESSION_ID_REGEX.test(sessionId)) {
        throw ApiError.badRequest('Invalid or missing 32-character hexadecimal session ID', 'INVALID_SESSION_ID');
      }

      const session = await sessionService.getSession(sessionId);
      if (!session) {
        throw ApiError.notFound('Session not found or has expired', 'SESSION_NOT_FOUND');
      }

      // Attach session info to req
      (req as unknown as { sessionRecord: typeof session }).sessionRecord = session;
      next();
    } catch (err) {
      next(err);
    }
  };
}
