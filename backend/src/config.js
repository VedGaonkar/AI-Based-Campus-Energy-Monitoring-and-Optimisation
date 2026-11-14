import { parse } from "dotenv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// Do not populate process.env: dev launcher children must read their own fresh
// file rather than inherit a stale copy loaded by their parent. Deployment-set
// environment variables explicitly take precedence over the local file.
export function readServerEnvironment(env = process.env, path = fileURLToPath(new URL("../../.env", import.meta.url))) {
  let file = {};
  try {
    const contents = readFileSync(path, "utf8");
    if ((contents.match(/^\s*(?:export\s+)?ADMIN_INVITE_KEY\s*=/gm) ?? []).length > 1)
      throw new Error("Duplicate ADMIN_INVITE_KEY entries in server .env. Keep one entry; values withheld.");
    file = parse(contents);
  }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  return { ...file, ...env };
}
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
export function loadConfig(env = readServerEnvironment()) {
  const parsed = z
    .object({
      NODE_ENV: z
        .enum(["development", "test", "production"])
        .default("development"),
      PORT: z.coerce.number().int().min(1).max(65535).default(5000),
      MONGODB_URI: z
        .string()
        .startsWith("mongodb")
        .default("mongodb://127.0.0.1:27017/campus_energy"),
      SESSION_SECRET: z
        .string()
        .min(32)
        .refine(
          (v) => !v.includes("replace_"),
          "Generate a real local secret with npm run setup",
        ),
      SERVICE_INGEST_TOKEN: z
        .string()
        .min(32)
        .refine((v) => !v.includes("replace_")),
      FRONTEND_ORIGIN: z.url().default("http://localhost:5173"),
      PUBLIC_APP_URL: z.url().default("http://localhost:5000"),
      DEMO_MODE: bool.default(true),
      ALLOW_PHYSICAL_CONTROL: bool.default(false),
      ALLOW_NATIVE_DEVICE_CONTROL: bool.default(false),
      HA_ALLOWED_ORIGINS: z.string().default(""),
      HA_ALLOW_HTTP: bool.default(false),
      HA_ALLOW_LOOPBACK: bool.default(false),
      OCR_PYTHON: z.string().min(1).default("python"),
      OCR_MODULE_PATH: z.string().optional(),
      OCR_TESSDATA_PATH: z.string().optional(),
      DEMO_VISION_PYTHON: z.string().min(1).default("python"),
      ENABLE_DEMO_SETUP: bool.default(false),
      ALLOW_PRODUCTION_DEMO_SEED: bool.default(false),
      DEMO_ADMIN_EMAIL: z.email().optional(),
      DEMO_ADMIN_PASSWORD: z.string().min(20).optional(),
      DEMO_VIEWER_EMAIL: z.email().optional(),
      DEMO_VIEWER_PASSWORD: z.string().min(20).optional(),
      DEMO_PHONE_ORIGINS: z.string().default("http://localhost:5174,http://localhost:5175"),
      DEVICE_ADAPTER: z.literal("simulator").default("simulator"),
      DEMO_TIME_SCALE: z.coerce.number().min(1).max(60).default(60),
      VACANCY_CONFIRMATION_MINUTES: z.coerce
        .number()
        .min(0.1)
        .max(120)
        .default(15),
      FIRST_ESCALATION_MINUTES: z.coerce.number().min(1).max(120).default(10),
      FINAL_ESCALATION_ADDITIONAL_MINUTES: z.coerce
        .number()
        .min(1)
        .max(120)
        .default(15),
      BOOKING_PREPARATION_MINUTES: z.coerce
        .number()
        .min(0)
        .max(120)
        .default(15),
      QR_MAX_DURATION_MINUTES: z.coerce
        .number()
        .int()
        .min(1)
        .max(120)
        .default(120),
      QR_EXPIRY_WARNING_MINUTES: z.coerce.number().min(0).max(30).default(10),
      NOTIFICATIONS_MODE: z.literal("in_app").default("in_app"),
      ADMIN_INVITE_KEY: z.string().trim().min(8).max(200).optional().or(z.literal("").transform(() => undefined)),

    })
    .parse(env);
  if (parsed.ALLOW_PHYSICAL_CONTROL)
    throw new Error(
      "No commissioned physical adapter exists; physical control must remain disabled",
    );
  if (!parsed.DEMO_MODE && parsed.DEMO_TIME_SCALE !== 1)
    throw new Error("Accelerated time is restricted to demo mode");
  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    mongoUri: parsed.MONGODB_URI,
    sessionSecret: parsed.SESSION_SECRET,
    adminInviteKey: parsed.ADMIN_INVITE_KEY ?? null,
    ingestToken: parsed.SERVICE_INGEST_TOKEN,
    frontendOrigin: parsed.FRONTEND_ORIGIN,
    publicAppUrl: parsed.PUBLIC_APP_URL,
    demoMode: parsed.DEMO_MODE,
    allowPhysicalControl: parsed.ALLOW_PHYSICAL_CONTROL,
    allowNativeControl: parsed.ALLOW_NATIVE_DEVICE_CONTROL,
    ocrPython: parsed.OCR_PYTHON, ocrModulePath: parsed.OCR_MODULE_PATH, ocrTessdataPath: parsed.OCR_TESSDATA_PATH,
    demoVisionPython: parsed.DEMO_VISION_PYTHON,
    enableDemoSetup: parsed.ENABLE_DEMO_SETUP,
    allowProductionDemoSeed: parsed.ALLOW_PRODUCTION_DEMO_SEED,
    demoAdminEmail: parsed.DEMO_ADMIN_EMAIL,
    demoAdminPassword: parsed.DEMO_ADMIN_PASSWORD,
    demoViewerEmail: parsed.DEMO_VIEWER_EMAIL,
    demoViewerPassword: parsed.DEMO_VIEWER_PASSWORD,
    demoPhoneOrigins: parsed.DEMO_PHONE_ORIGINS.split(",").map(value => value.trim()).filter(Boolean),
    haAllowedOrigins: parsed.HA_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean),
    haAllowHttp: parsed.HA_ALLOW_HTTP,
    haAllowLoopback: parsed.HA_ALLOW_LOOPBACK,
    deviceAdapter: parsed.DEVICE_ADAPTER,
    timeScale: parsed.DEMO_MODE ? parsed.DEMO_TIME_SCALE : 1,
    vacancyMs:
      (parsed.VACANCY_CONFIRMATION_MINUTES * 60000) /
      (parsed.DEMO_MODE ? parsed.DEMO_TIME_SCALE : 1),
    firstEscalationMs:
      (parsed.FIRST_ESCALATION_MINUTES * 60000) /
      (parsed.DEMO_MODE ? parsed.DEMO_TIME_SCALE : 1),
    finalAdditionalMs:
      (parsed.FINAL_ESCALATION_ADDITIONAL_MINUTES * 60000) /
      (parsed.DEMO_MODE ? parsed.DEMO_TIME_SCALE : 1),
    preparationMs: parsed.BOOKING_PREPARATION_MINUTES * 60000,
    qrMaxMinutes: parsed.QR_MAX_DURATION_MINUTES,
    qrWarningMs:
      (parsed.QR_EXPIRY_WARNING_MINUTES * 60000) /
      (parsed.DEMO_MODE ? parsed.DEMO_TIME_SCALE : 1),
    demoPassword: env.DEMO_PASSWORD,
  };
}
