// Boots the REAL website backend (read-only imports from ../../backend) on an in-memory MongoDB,
// plus the assistant in front of it. Nothing outside website-smart-bot/ is written to.
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createAssistantServer } from '../src/server.js';
import { createAppClient } from '../src/appClient.js';
import { loadConfig } from '../src/config.js';
import { openStore } from '../src/store.js';

const root = new URL('../../', import.meta.url);
const rootRequire = createRequire(new URL('package.json', root));

const { createApplication } = await import(new URL('backend/src/app.js', root));
const { loadConfig: loadAppConfig } = await import(new URL('backend/src/config.js', root));
const { connectDatabase } = await import(new URL('backend/src/models/index.js', root));
const { seed } = await import(new URL('backend/src/seed.js', root));
const { MongoMemoryServer } = rootRequire('mongodb-memory-server');

export const APP_ORIGIN = 'http://localhost:5000';
export const BOT_ORIGIN = 'http://localhost:5190';

const mongodBinary = () => {
  const candidate = process.env.MONGOMS_SYSTEM_BINARY ?? fileURLToPath(new URL('node_modules/.cache/mongodb-memory-server/mongod-x64-win32-8.2.6.exe', root));
  if (!existsSync(candidate)) throw new Error(`No mongod binary at ${candidate}. Set MONGOMS_SYSTEM_BINARY to a mongod executable.`);
  return candidate;
};

const cookiesFrom = (res) => res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
const listen = (server, port = 0) => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server.address().port)));
export const freePort = async () => {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
};
const stop = (server) => new Promise((resolve) => server.close(resolve));

export async function startWebsite() {
  const db = new MongoMemoryServer({ binary: { systemBinary: mongodBinary(), version: '8.2.6' }, instance: { ip: '127.0.0.1', storageEngine: 'wiredTiger' } });
  await db.start();
  const { connection, models } = await connectDatabase(db.getUri('assistant_test'));
  const password = randomBytes(18).toString('hex');
  const adminKey = String(randomInt(10_000_000, 100_000_000));
  const config = loadAppConfig({
    NODE_ENV: 'test',
    MONGODB_URI: db.getUri('assistant_test'),
    SESSION_SECRET: randomBytes(32).toString('hex'),
    SERVICE_INGEST_TOKEN: randomBytes(32).toString('hex'),
    ADMIN_INVITE_KEY: adminKey,
    DEMO_MODE: 'true',
    PUBLIC_APP_URL: APP_ORIGIN,
  });
  await seed(models, config, { password });
  const runtime = createApplication({ config, connection, models });
  const port = await listen(runtime.server);
  const api = `http://127.0.0.1:${port}/api/v1`;

  // Signs in exactly like the website's own pages do.
  async function login(role, email = `${role}@campus.test`) {
    const csrfRes = await fetch(`${api}/auth/csrf`);
    let cookie = cookiesFrom(csrfRes);
    const csrf = (await csrfRes.json()).data.csrfToken;
    const res = await fetch(`${api}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_ORIGIN, 'x-csrf-token': csrf, cookie },
      body: JSON.stringify({ email, password, ...(role === 'admin' ? { adminKey } : {}) }),
    });
    if (res.status !== 200) throw new Error(`login as ${role} failed: ${res.status} ${await res.text()}`);
    cookie = cookiesFrom(res) || cookie;
    const body = (await res.json()).data;
    return { role, cookie, csrf: body.csrfToken, user: body.user };
  }

  // Direct call to the website API as a person, used to set up and verify state independently of the assistant.
  const call = async (session, method, path, body) => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: { 'content-type': 'application/json', cookie: session.cookie, ...(method !== 'GET' ? { origin: APP_ORIGIN, 'x-csrf-token': session.csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // A second, independent administrator (created by the first, then signed in with the admin key).
  async function secondAdmin(creator) {
    const email = `admin2-${randomBytes(3).toString('hex')}@campus.test`;
    const made = await call(creator, 'POST', '/users', { name: 'Second administrator', email, password, role: 'admin', permittedRoomIds: [] });
    if (made.status !== 201) throw new Error(`could not create second admin: ${made.status} ${JSON.stringify(made.body)}`);
    return login('admin', email);
  }

  return {
    api,
    models,
    login,
    call,
    secondAdmin,
    async close() {
      await runtime.close();
      await stop(runtime.server);
      await connection.close();
      await db.stop();
    },
  };
}

export function scriptedGemini({ delayMs = 0 } = {}) {
  const calls = [];
  const queue = [];
  const generate = async (request) => {
    calls.push(request);
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const next = queue.shift();
    if (!next) return { text: 'Scripted answer.', functionCalls: [] };
    if (next.throw) throw next.throw;
    return { text: next.text ?? '', functionCalls: next.functionCalls ?? [] };
  };
  const apiError = (status, message) => Object.assign(new Error(message), { status });
  return { generate, calls, queue, apiError, push: (...items) => queue.push(...items) };
}

export async function startAssistant({ website, env = {}, fake, appFetch, clock, port: fixedPort } = {}) {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    APP_API_URL: website.api,
    APP_ORIGIN,
    APP_PUBLIC_URL: 'http://localhost:5173',
    ASSISTANT_PUBLIC_URL: BOT_ORIGIN,
    GEMINI_API_KEY: fake ? 'AIza-test-key-must-never-leak' : '',
    DATA_CACHE_TTL_SECONDS: '0',
    GEMINI_USER_MIN_INTERVAL_SECONDS: '0',
    GEMINI_RPM: '100',
    GEMINI_VIEWER_PER_USER_DAILY: '50',
    GEMINI_ADMIN_PER_USER_DAILY: '50',
    GEMINI_RPD: '100',
    GEMINI_ADMIN_RESERVE: '10',
    MESSAGES_PER_MINUTE: '1000',
    CONFIRMS_PER_MINUTE: '1000',
    ...env,
  });
  const appClient = createAppClient({ baseUrl: cfg.appApiUrl, origin: cfg.appOrigin, fetchImpl: appFetch ?? fetch });
  const store = openStore(':memory:');
  // With a test clock, "waiting" moves that clock forward exactly as real waiting would.
  const wait = async (ms) => {
    if (clock) clock.t += ms;
  };
  const server = createAssistantServer({ cfg, store, appClient, generate: fake?.generate, wait, now: clock ? () => clock.t : undefined });
  const http = await import('node:http');
  const httpServer = http.createServer(server.app);
  const port = await listen(httpServer, fixedPort);
  const base = `http://127.0.0.1:${port}`;

  const request = async (session, method, path, body, { origin = cfg.publicUrl, csrf = session?.csrf } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(session ? { cookie: session.cookie } : {}),
        ...(method !== 'GET' ? { origin, ...(csrf ? { 'x-csrf-token': csrf } : {}) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* static asset */
    }
    return { status: res.status, body: json, text, headers: res.headers };
  };

  let counter = 0;
  return {
    ...server,
    base,
    cfg,
    request,
    // Sends one chat message and returns the assistant's reply.
    async chat(session, message, extra = {}) {
      const res = await request(session, 'POST', '/api/message', { message, conversationId: extra.conversationId ?? `c-${session.role}`, messageId: extra.messageId ?? `m-${(counter += 1)}-${randomBytes(3).toString('hex')}` });
      if (res.status !== 200) throw new Error(`chat failed ${res.status}: ${res.text}`);
      return res.body.reply;
    },
    confirm: (session, proposalId) => request(session, 'POST', '/api/confirm', { proposalId }),
    cancel: (session, proposalId) => request(session, 'POST', '/api/cancel', { proposalId }),
    async close() {
      await stop(httpServer);
      server.close();
    },
  };
}
