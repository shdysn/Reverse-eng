import { createApp } from './app.js';
import { env } from './config/env.js';
import { sessionService } from './services/session.service.js';

const app = createApp();
const PORT = env.PORT || 8000;
const HOST = '0.0.0.0';

async function bootstrap() {
  await sessionService.initialize();

  // Periodic cleanup of expired sessions every hour
  const cleanupInterval = setInterval(() => {
    sessionService.cleanupExpiredSessions().catch((err) => {
      console.error('Periodic session cleanup failed:', err);
    });
  }, 60 * 60 * 1000);

  const server = app.listen(PORT, HOST, () => {
    console.log(`====================================================`);
    console.log(`Android Reverse Engineering Dashboard - API Backend`);
    console.log(`Authorized Use Only`);
    console.log(`Listening on http://${HOST}:${PORT}`);
    console.log(`Work Root: ${env.WORK_ROOT}`);
    console.log(`====================================================`);
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`\nReceived ${signal}. Gracefully shutting down...`);
    clearInterval(cleanupInterval);
    server.close(() => {
      console.log('HTTP server closed. Exiting process.');
      process.exit(0);
    });

    // Force shutdown after 10s if connections linger
    setTimeout(() => {
      console.error('Forced shutdown due to lingering connections.');
      process.exit(1);
    }, 10000).unref();
  };

  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Promise Rejection:', reason);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
