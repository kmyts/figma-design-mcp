import { execSync } from 'child_process';
import express from 'express';
import { commandQueue } from './queue.js';

const HTTP_PORT = 3848;

export function killStaleInstances(): boolean {
  let killed = false;
  try {
    const lines = execSync(`lsof -ti :${HTTP_PORT}`, { encoding: 'utf-8' }).trim();
    if (!lines) return false;

    for (const pidStr of lines.split('\n')) {
      const pid = Number(pidStr);
      if (!pid || pid === process.pid) continue;
      try {
        const cmdline = execSync(`ps -p ${pid} -o args=`, { encoding: 'utf-8' }).trim();
        if (cmdline.includes('figma-design-mcp')) {
          process.kill(pid, 'SIGTERM');
          killed = true;
          console.error(`[figma-design] Killed stale instance (PID ${pid})`);
        } else {
          console.error(`[figma-design] Port ${HTTP_PORT} in use by another program: ${cmdline}`);
        }
      } catch (_) { /* process already gone */ }
    }
  } catch (_) { /* no process on port */ }
  return killed;
}

function createApp(): express.Express {
  const app = express();

  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
  });
  app.options('*', (_req, res) => { res.sendStatus(200); });
  app.use(express.json({ limit: '50mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', pendingCommands: commandQueue.length });
  });

  app.get('/commands/poll', (_req, res) => {
    if (commandQueue.length === 0) {
      res.sendStatus(204);
      return;
    }
    const cmd = commandQueue[0];
    res.json({ id: cmd.id, type: cmd.type, payload: cmd.payload });
  });

  app.post('/commands/:id/result', (req, res) => {
    const { id } = req.params;
    const idx = commandQueue.findIndex(c => c.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Command not found or already resolved' });
      return;
    }
    const cmd = commandQueue.splice(idx, 1)[0];
    const body = req.body as { success: boolean; result?: unknown; error?: string };
    if (body.success) {
      cmd.resolve(body.result);
    } else {
      cmd.reject(new Error(body.error || 'Plugin reported failure'));
    }
    res.json({ ok: true });
  });

  return app;
}

function listenWithRetry(app: express.Express, retriesLeft: number): void {
  const httpServer = app.listen(HTTP_PORT, () => {
    console.error(`[figma-design] HTTP server listening on port ${HTTP_PORT}`);
  });
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && retriesLeft > 0) {
      console.error(`[figma-design] Port ${HTTP_PORT} not yet free, retrying in 500ms…`);
      setTimeout(() => listenWithRetry(app, retriesLeft - 1), 500);
    } else if (err.code === 'EADDRINUSE') {
      console.error(`[figma-design] Port ${HTTP_PORT} still in use — exiting.`);
      process.exit(1);
    } else {
      console.error('[figma-design] HTTP server error:', err);
    }
  });
}

export function startHttpServer(): void {
  const killed = killStaleInstances();
  const app = createApp();
  // If we killed a stale process, retry a few times to let the port free up
  listenWithRetry(app, killed ? 3 : 0);
}
