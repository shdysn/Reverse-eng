import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './server/src/app.js';
import { sessionService } from './server/src/services/session.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = '0.0.0.0';

async function start() {
  await sessionService.initialize();

  const app = createApp();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files from client build
    const clientDist = path.join(__dirname, 'client', 'dist');
    const rootDist = path.join(__dirname, 'dist');
    const staticDir = (await import('node:fs')).existsSync(clientDist) ? clientDist : rootDist;

    app.use(express.static(staticDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`====================================================`);
    console.log(`Android Reverse Engineering Dashboard - Unified Server`);
    console.log(`Authorized Use Only`);
    console.log(`Listening on http://${HOST}:${PORT}`);
    console.log(`====================================================`);
  });

  const shutdown = (sig: string) => {
    console.log(`Received ${sig}. Shutting down...`);
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('Unified server failed to start:', err);
  process.exit(1);
});
