import { timingSafeEqual } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { createActions } from './actions.js';
import { AppApiError, createAppClient } from './appClient.js';
import { createAssistant } from './assistant.js';
import { loadConfig, loadEnvFile, publicConfigView } from './config.js';
import { createData } from './data.js';
import { createLlm } from './llm.js';
import { createBudget } from './quota.js';
import { openStore } from './store.js';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../public');

const sameSecret = (a, b) => {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const messageBody = z.object({ message: z.string().min(1).max(600), conversationId: z.string().max(64).optional(), messageId: z.string().max(80).optional() }).strict();
const proposalBody = z.object({ proposalId: z.uuid() }).strict();

export function createAssistantServer(deps = {}) {
  const cfg = deps.cfg ?? loadConfig();
  const now = deps.now ?? (() => Date.now());
  const store = deps.store ?? openStore(cfg.dbPath);
  const appClient = deps.appClient ?? createAppClient({ baseUrl: cfg.appApiUrl, origin: cfg.appOrigin });
  const budget = createBudget({ store, quota: cfg.quota, now });
  const llm = deps.llm ?? createLlm({ config: cfg, budget, generate: deps.generate, wait: deps.wait, log: (m) => cfg.env !== 'test' && console.warn(`[assistant] ${m}`) });
  const data = createData({ ttlMs: cfg.dataCacheTtlMs, timezone: cfg.timezone });
  const actions = createActions({ store, cfg, data, now });
  const assistant = createAssistant({ cfg, store, data, actions, llm, budget, now });

  const app = express();
  app.disable('x-powered-by');

  const frameAncestors = [...new Set([cfg.appOrigin, cfg.appPublicUrl])].join(' ');
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    if (req.path.startsWith('/api')) res.set('Cache-Control', 'no-store');
    if (req.path === '/' || req.path === '/chat') {
      // Only the website itself may embed the chat panel.
      res.set('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors ${frameAncestors}`);
    }
    next();
  });

  app.get(['/', '/chat'], (_req, res) => res.sendFile(resolve(publicDir, 'chat.html')));
  app.get('/widget.js', (_req, res) => res.type('application/javascript').set('Cache-Control', 'no-cache').sendFile(resolve(publicDir, 'widget.js')));
  app.get('/chat.js', (_req, res) => res.type('application/javascript').sendFile(resolve(publicDir, 'chat.js')));
  app.get('/chat.css', (_req, res) => res.type('text/css').sendFile(resolve(publicDir, 'chat.css')));

  app.get('/api/health', (_req, res) => res.json({ ok: true, ...publicConfigView(cfg) }));

  // Everything below needs a signed-in website session. The website decides who the person is.
  const api = express.Router();
  api.use(express.json({ limit: '16kb' }));
  api.use(async (req, _res, next) => {
    const session = await appClient.identify(req.headers.cookie);
    if (!session) throw new HttpError(401, 'NOT_SIGNED_IN', 'Sign in to the website first.', { loginUrl: cfg.appPublicUrl });
    req.assistantSession = session;
    next();
  });

  const windows = new Map();
  const throttle = (name, limit) => (req, _res, next) => {
    const t = now();
    const key = `${name}:${req.assistantSession.user.id}`;
    const recent = (windows.get(key) ?? []).filter((x) => t - x < 60_000);
    if (recent.length >= limit) throw new HttpError(429, 'RATE_LIMITED', 'Too many requests. Wait a moment and try again.');
    recent.push(t);
    windows.set(key, recent);
    next();
  };

  // Writes must come from the assistant's own page and carry the website's per-session CSRF token.
  const guardWrite = (req, _res, next) => {
    if (!(deps.allowedOrigins ?? [cfg.publicUrl]).includes(req.get('origin'))) throw new HttpError(403, 'ORIGIN_REJECTED', 'Request origin is not allowed.');
    if (!sameSecret(req.get('x-csrf-token'), req.assistantSession.csrf)) throw new HttpError(403, 'CSRF_REJECTED', 'Reload the page and try again.');
    next();
  };

  const requireAdmin = (req, _res, next) => {
    if (req.assistantSession.user.role !== 'admin') throw new HttpError(403, 'FORBIDDEN', 'Administrators only.');
    next();
  };

  api.get('/session', async (req, res) => {
    const u = req.assistantSession.user;
    res.json({ user: { id: u.id, name: u.name, role: u.role }, csrfToken: req.assistantSession.csrf, appUrl: cfg.appPublicUrl, ...(await assistant.sessionInfo(req.assistantSession)) });
  });

  api.post('/message', guardWrite, throttle('message', cfg.messagesPerMinute), async (req, res) => {
    const body = messageBody.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Send a message of up to 600 characters.');
    res.json({ reply: await assistant.handle(req.assistantSession, body.data), serverTime: new Date(now()).toISOString() });
  });

  const proposalRoute = (fn) => async (req, res) => {
    const body = proposalBody.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'VALIDATION_ERROR', 'A proposal id is required.');
    const out = await fn(req.assistantSession, body.data.proposalId);
    res.status(out.ok ? 200 : (out.status ?? 409)).json(out);
  };
  api.post('/confirm', guardWrite, requireAdmin, throttle('confirm', cfg.confirmsPerMinute), proposalRoute((s, id) => assistant.confirm(s, id)));
  api.post('/cancel', guardWrite, requireAdmin, proposalRoute(async (s, id) => assistant.cancel(s, id)));

  api.get('/announcements', (req, res) => res.json({ announcements: assistant.announcements(req.assistantSession.user) }));
  api.post('/announcements/read', guardWrite, (req, res) => {
    assistant.markAllRead(req.assistantSession.user);
    res.json({ ok: true });
  });

  api.get('/quota', requireAdmin, (_req, res) => res.json({ quota: budget.snapshot(), ...publicConfigView(cfg) }));
  api.get('/audit', requireAdmin, (_req, res) => res.json({ entries: store.stmts.listAudit.all(100) }));

  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Unknown route.')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.extra ?? {}) } });
    if (err instanceof AppApiError) {
      const status = err.status === 401 || err.status === 403 ? 403 : err.status === 404 ? 404 : err.status === 503 ? 503 : err.status >= 500 ? 502 : 409;
      return res.status(status).json({ error: { code: err.code, message: err.message } });
    }
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'The request body is not valid.' } });
    if (cfg.env !== 'test') console.error('[assistant] unhandled error:', err?.name, err?.message);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Nothing was changed unless a result says so.' } });
  });

  return { app, assistant, store, budget, data, actions, cfg, close: () => store.close() };
}

async function main() {
  loadEnvFile();
  const cfg = loadConfig();
  const { app } = createAssistantServer({ cfg });
  app.listen(cfg.port, () => {
    console.log(`Website assistant on ${cfg.publicUrl}  (chat page: ${cfg.publicUrl}/chat)`);
    console.log(`Website API: ${cfg.appApiUrl}   Gemini: ${cfg.gemini.apiKey ? `key configured, model "${cfg.gemini.model}" (run npm run check:model to confirm it exists)` : 'no key, so only direct website answers'}`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
