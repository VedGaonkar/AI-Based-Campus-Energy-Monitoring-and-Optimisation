import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { dbReady } from './db.js';
import { adminRouter } from './routes/admin.js';
import { authRouter, serverView } from './routes/auth.js';
import { energyRouter } from './routes/energy.js';
import { incidentsRouter } from './routes/incidents.js';
import { roomsRouter } from './routes/rooms.js';
import { createSessionMiddleware, loadUser, originCheck } from './security/auth.js';
import { ApiError } from './services/core.js';

const FRONTEND_DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');

export function createApp() {
  const cfg = config();
  const app = express();
  const sessionMiddleware = createSessionMiddleware();

  app.disable('x-powered-by');
  if (cfg.env === 'production') app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'data:'], styleSrc: ["'self'", "'unsafe-inline'"], connectSrc: ["'self'", 'ws:', 'wss:'] },
      },
    }),
  );

  // Cross-origin access exists only for the Vite dev server; the built frontend is same-origin.
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin && origin === cfg.frontendOrigin) {
      res.set({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', Vary: 'Origin' });
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });

  const api = express.Router();
  api.use(express.json({ limit: '9mb' }));
  api.get('/health', (_req, res) => res.json({ status: 'ok', server: serverView() }));
  api.get('/ready', (_req, res) => (dbReady() ? res.json({ status: 'ready' }) : res.status(503).json({ status: 'database unavailable' })));
  api.use(sessionMiddleware);
  api.use(originCheck);
  api.use(loadUser);
  api.use('/auth', authRouter);
  api.use(roomsRouter);
  api.use(energyRouter);
  api.use(incidentsRouter);
  api.use(adminRouter);
  api.use((_req, _res, next) => next(new ApiError(404, 'not_found', 'Unknown API route')));

  // Standard error shape: { error: { code, message, details? } }
  // eslint-disable-next-line no-unused-vars
  api.use((err, _req, res, _next) => {
    if (err instanceof ApiError) return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: { code: 'payload_too_large', message: 'Request body is too large' } });
    if (err?.name === 'ValidationError') return res.status(400).json({ error: { code: 'validation_failed', message: err.message } });
    if (err?.code === 11000) return res.status(409).json({ error: { code: 'duplicate', message: 'A record with the same unique value already exists' } });
    if (cfg.env !== 'test') console.error('[api] unhandled error:', err);
    res.status(500).json({ error: { code: 'internal_error', message: 'Unexpected server error' } });
  });

  app.use('/api/v1', api);

  if (fs.existsSync(path.join(FRONTEND_DIST, 'index.html'))) {
    app.use(express.static(FRONTEND_DIST));
    app.use((req, res, next) => (req.method === 'GET' ? res.sendFile(path.join(FRONTEND_DIST, 'index.html')) : next()));
  }

  return { app, sessionMiddleware };
}
