import 'dotenv/config';
import { z } from 'zod';

const bool = (def) =>
  z
    .enum(['true', 'false'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  APP_TIMEZONE: z.string().default('Asia/Kolkata'),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/campus_energy'),
  SESSION_SECRET: z.string().min(16).default('replace_with_a_generated_secret'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_APP_URL: z.string().default('http://localhost:5000'),
  DEMO_MODE: bool(true),
  ALLOW_PHYSICAL_CONTROL: bool(false),
  DEMO_TIME_SCALE: z.coerce.number().min(1).max(600).default(60),
  DEVICE_ADAPTER: z.enum(['simulator', 'physical']).default('simulator'),
  VISION_BASE_URL: z.string().default(''),
  SERVICE_INGEST_TOKEN: z.string().default('replace_with_a_separate_service_secret'),
  NOTIFICATIONS_MODE: z.enum(['in_app']).default('in_app'),
  WORKER_INLINE: bool(true),
  WORKER_POLL_MS: z.coerce.number().int().min(100).default(1000),
  SEED_PASSWORD: z.string().min(8).default('demo-password'),
  VACANCY_CONFIRMATION_MINUTES: z.coerce.number().positive().default(15),
  FIRST_ESCALATION_MINUTES: z.coerce.number().positive().default(10),
  FINAL_ESCALATION_ADDITIONAL_MINUTES: z.coerce.number().positive().default(15),
  BOOKING_PREPARATION_MINUTES: z.coerce.number().min(0).default(15),
  QR_MAX_DURATION_MINUTES: z.coerce.number().positive().default(120),
  QR_EXPIRY_WARNING_MINUTES: z.coerce.number().positive().default(10),
});

const PLACEHOLDERS = ['replace_with_a_generated_secret', 'replace_with_a_separate_service_secret'];

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  }
  const c = parsed.data;
  const problems = [];

  if (c.DEMO_MODE && c.ALLOW_PHYSICAL_CONTROL) {
    problems.push('ALLOW_PHYSICAL_CONTROL cannot be true while DEMO_MODE is true');
  }
  if (c.DEMO_MODE && c.DEVICE_ADAPTER !== 'simulator') {
    problems.push('DEMO_MODE requires DEVICE_ADAPTER=simulator');
  }
  if (!c.DEMO_MODE && c.DEMO_TIME_SCALE !== 1) {
    // Accelerated time exists only inside isolated simulation.
    c.DEMO_TIME_SCALE = 1;
  }
  if (c.DEVICE_ADAPTER === 'physical' && !c.ALLOW_PHYSICAL_CONTROL) {
    problems.push('DEVICE_ADAPTER=physical requires ALLOW_PHYSICAL_CONTROL=true');
  }
  if (c.NODE_ENV === 'production') {
    if (PLACEHOLDERS.includes(c.SESSION_SECRET)) problems.push('SESSION_SECRET is a placeholder');
    if (PLACEHOLDERS.includes(c.SERVICE_INGEST_TOKEN)) problems.push('SERVICE_INGEST_TOKEN is a placeholder');
    if (c.SEED_PASSWORD === 'demo-password' && !c.DEMO_MODE) problems.push('SEED_PASSWORD is the demo default');
  }
  if (problems.length) throw new Error(`Invalid configuration: ${problems.join('; ')}`);

  return Object.freeze({
    env: c.NODE_ENV,
    port: c.PORT,
    timezone: c.APP_TIMEZONE,
    mongoUri: c.MONGODB_URI,
    sessionSecret: c.SESSION_SECRET,
    frontendOrigin: c.FRONTEND_ORIGIN,
    publicAppUrl: c.PUBLIC_APP_URL,
    demoMode: c.DEMO_MODE,
    allowPhysicalControl: c.ALLOW_PHYSICAL_CONTROL,
    demoTimeScale: c.DEMO_MODE ? c.DEMO_TIME_SCALE : 1,
    deviceAdapter: c.DEVICE_ADAPTER,
    visionBaseUrl: c.VISION_BASE_URL,
    serviceIngestToken: c.SERVICE_INGEST_TOKEN,
    notificationsMode: c.NOTIFICATIONS_MODE,
    workerInline: c.WORKER_INLINE,
    workerPollMs: c.WORKER_POLL_MS,
    seedPassword: c.SEED_PASSWORD,
    defaults: {
      vacancyConfirmationMinutes: c.VACANCY_CONFIRMATION_MINUTES,
      firstEscalationMinutes: c.FIRST_ESCALATION_MINUTES,
      finalEscalationAdditionalMinutes: c.FINAL_ESCALATION_ADDITIONAL_MINUTES,
      bookingPreparationMinutes: c.BOOKING_PREPARATION_MINUTES,
      qrMaxDurationMinutes: c.QR_MAX_DURATION_MINUTES,
      qrExpiryWarningMinutes: c.QR_EXPIRY_WARNING_MINUTES,
    },
  });
}

let current = null;

export function config() {
  if (!current) current = loadConfig();
  return current;
}

export function setConfigForTests(overrides = {}) {
  current = loadConfig({ NODE_ENV: 'test', ...overrides });
  return current;
}
