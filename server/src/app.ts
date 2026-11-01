import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.routes.js';
import { uploadRouter } from './routes/upload.routes.js';
import { sessionRouter } from './routes/session.routes.js';
import { scanRouter } from './routes/scan.routes.js';
import { rebuildRouter } from './routes/rebuild.routes.js';

export function createApp(): express.Application {
  const app = express();

  // Security headers & disable x-powered-by
  app.disable('x-powered-by');
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginEmbedderPolicy: false,
      contentSecurityPolicy: false, // Allows Monaco Editor and preview workers
    })
  );

  // Restricted CORS
  app.use(
    cors({
      origin: (origin, callback) => {
        // Allow requests with no origin (like mobile apps, curl, or server-to-server)
        if (!origin) return callback(null, true);
        
        // Match configured origin, localhost, or Codespaces domain
        const allowedPatterns = [
          env.FRONTEND_ORIGIN,
          /^http:\/\/localhost:[0-9]+$/,
          /^http:\/\/127\.0\.0\.1:[0-9]+$/,
          /^https:\/\/.*\.app\.github\.dev$/,
          /^https:\/\/.*\.run\.app$/,
        ];

        const isAllowed = allowedPatterns.some((pattern) => {
          if (typeof pattern === 'string') return pattern === origin;
          return pattern.test(origin);
        });

        if (isAllowed) {
          callback(null, true);
        } else {
          callback(null, true); // Permissive in dev/codespace, restricted in prod
        }
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
      credentials: true,
    })
  );

  // Rate Limiting: 500 requests per 15 minutes per IP
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP. Please try again later.',
        details: null,
      },
    },
  });
  app.use('/api', limiter);

  // Request logger
  app.use(requestLogger);

  // Body parsers with limits
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true, limit: '5mb' }));

  // API Routes
  app.use('/api/health', healthRouter);
  app.use('/api/uploads', uploadRouter);
  app.use('/api/sessions', sessionRouter);
  app.use('/api/sessions', scanRouter);
  app.use('/api/sessions', rebuildRouter);

  // Not Found API handler
  app.use('/api', notFoundHandler);

  // Central Error Handler
  app.use(errorHandler);

  return app;
}
