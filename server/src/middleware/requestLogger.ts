import type { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const reqId = randomUUID().substring(0, 8);
  req.headers['x-request-id'] = reqId;
  res.setHeader('X-Request-ID', reqId);

  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const { statusCode } = res;
    // Mask sensitive parameters if any
    const sanitizedUrl = originalUrl.replace(/(password|token|key)=[^&]*/gi, '$1=***');
    if (process.env.NODE_ENV !== 'test') {
      console.log(`[${reqId}] ${method} ${sanitizedUrl} -> ${statusCode} (${duration}ms)`);
    }
  });

  next();
}
