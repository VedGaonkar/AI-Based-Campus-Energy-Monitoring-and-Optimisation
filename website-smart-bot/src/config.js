import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Only this folder's own .env is read. The website's .env holds unrelated secrets and is never touched.
export function loadEnvFile(path = resolve(root, '.env')) {
  if (existsSync(path)) process.loadEnvFile(path);
}

const int = (def, min = 0) => z.coerce.number().int().min(min).default(def);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ASSISTANT_PORT: int(5190, 1),
  // Where the assistant itself is served (used to check the Origin of browser requests).
  ASSISTANT_PUBLIC_URL: z.string().default('http://localhost:5190'),
  // The existing website's API. All data and every change goes through it.
  APP_API_URL: z.string().default('http://127.0.0.1:5000/api/v1'),
  // The website origin the API already trusts for cookie-authenticated writes.
  APP_ORIGIN: z.string().default('http://localhost:5173'),
  // Where record links in answers point (the website's own front end).
  APP_PUBLIC_URL: z.string().default('http://localhost:5173'),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  GEMINI_API_KEY: z.string().default(''),
  // Model identifier is configuration, never hardcoded elsewhere. Verify with: npm run check:model
  GEMINI_MODEL: z.string().min(1).default('gemini-3.8-flash'),
  GEMINI_TIMEOUT_MS: int(20000, 1000),
  // Reasoning effort. Lower is much faster; 'DEFAULT' leaves the model's own setting.
  GEMINI_THINKING_LEVEL: z.enum(['DEFAULT', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH']).default('MINIMAL'),
  // Answers are short, but a reasoning model's thinking tokens can count against this cap, so leave headroom.
  GEMINI_MAX_OUTPUT_TOKENS: int(1500, 64),
  // Limits shown on the Gemini API dashboard for this project.
  GEMINI_RPM: int(5, 1),
  GEMINI_RPD: int(20, 1),
  // Daily requests held back so administrators can still act after viewers have used theirs.
  GEMINI_ADMIN_RESERVE: int(8),
  GEMINI_VIEWER_PER_USER_DAILY: int(3),
  GEMINI_ADMIN_PER_USER_DAILY: int(14),
  GEMINI_USER_MIN_INTERVAL_SECONDS: int(15),
  // Gemini API daily quotas reset at midnight Pacific time.
  GEMINI_QUOTA_RESET_TZ: z.string().default('America/Los_Angeles'),
  GEMINI_MAX_RETRY_WAIT_SECONDS: int(20),
  GEMINI_CACHE_TTL_SECONDS: int(600),
  DATA_CACHE_TTL_SECONDS: int(3),
  HISTORY_TURNS: int(6),
  // Per-person request limits on the assistant itself (separate from Gemini's quota).
  MESSAGES_PER_MINUTE: int(30, 1),
  CONFIRMS_PER_MINUTE: int(20, 1),
  PROPOSAL_TTL_MINUTES: int(10, 1),
  DB_PATH: z.string().default(resolve(root, '.data/assistant.sqlite')),
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid assistant configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const c = parsed.data;
  if (c.GEMINI_ADMIN_RESERVE >= c.GEMINI_RPD) throw new Error('GEMINI_ADMIN_RESERVE must be lower than GEMINI_RPD');
  const strip = (u) => u.replace(/\/+$/, '');
  return Object.freeze({
    env: c.NODE_ENV,
    port: c.ASSISTANT_PORT,
    publicUrl: strip(c.ASSISTANT_PUBLIC_URL),
    appApiUrl: strip(c.APP_API_URL),
    appOrigin: strip(c.APP_ORIGIN),
    appPublicUrl: strip(c.APP_PUBLIC_URL),
    timezone: c.APP_TIMEZONE,
    gemini: {
      apiKey: c.GEMINI_API_KEY,
      model: c.GEMINI_MODEL,
      timeoutMs: c.GEMINI_TIMEOUT_MS,
      thinkingLevel: c.GEMINI_THINKING_LEVEL,
      maxOutputTokens: c.GEMINI_MAX_OUTPUT_TOKENS,
      maxRetryWaitMs: c.GEMINI_MAX_RETRY_WAIT_SECONDS * 1000,
      cacheTtlMs: c.GEMINI_CACHE_TTL_SECONDS * 1000,
    },
    quota: {
      rpm: c.GEMINI_RPM,
      rpd: c.GEMINI_RPD,
      adminReserve: c.GEMINI_ADMIN_RESERVE,
      viewerPerUserDaily: c.GEMINI_VIEWER_PER_USER_DAILY,
      adminPerUserDaily: c.GEMINI_ADMIN_PER_USER_DAILY,
      userMinIntervalMs: c.GEMINI_USER_MIN_INTERVAL_SECONDS * 1000,
      resetTz: c.GEMINI_QUOTA_RESET_TZ,
    },
    dataCacheTtlMs: c.DATA_CACHE_TTL_SECONDS * 1000,
    historyTurns: c.HISTORY_TURNS,
    messagesPerMinute: c.MESSAGES_PER_MINUTE,
    confirmsPerMinute: c.CONFIRMS_PER_MINUTE,
    proposalTtlMs: c.PROPOSAL_TTL_MINUTES * 60_000,
    dbPath: c.DB_PATH,
  });
}

export const publicConfigView = (cfg) => ({
  model: cfg.gemini.model,
  geminiConfigured: Boolean(cfg.gemini.apiKey),
  limits: { perMinute: cfg.quota.rpm, perDay: cfg.quota.rpd },
});
