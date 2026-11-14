import { parse } from "dotenv";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { deploymentOrigin } from "../../shared/deployment-origins.js";

// Do not populate process.env: dev launcher children must read their own fresh
// file rather than inherit a stale copy loaded by their parent. Deployment-set
// environment variables explicitly take precedence over the local file.
export function readServerEnvironment(env = process.env, path = fileURLToPath(new URL("../../.env", import.meta.url))) {
  if (env.NODE_ENV === "production") return { ...env };
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
      HOST: z.enum(["127.0.0.1", "0.0.0.0", "::1", "::"]).default(env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1"),
      MONGODB_URI: z
        .string()
        .regex(/^mongodb(?:\+srv)?:\/\//, "Use a MongoDB connection URI")
        .default(env.NODE_ENV === "production" ? "" : "mongodb://127.0.0.1:27017/campus_energy").refine(value => Boolean(value), "Required in production"),
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
      ASSISTANT_DATA_DIR: z.string().min(1).optional(),
      OCR_PYTHON: z.string().min(1).default("python"),
      OCR_MODULE_PATH: z.string().optional(),
      OCR_TESSDATA_PATH: z.string().optional(),
      DEMO_VISION_PYTHON: z.string().min(1).default("python"),
      ENABLE_DEMO_SETUP: bool.default(false),
      ALLOW_PRODUCTION_DEMO_SEED: bool.default(false),
      DEMO_ADMIN_EMAIL: z.string().optional(),
      DEMO_ADMIN_PASSWORD: z.string().optional(),
      DEMO_VIEWER_EMAIL: z.string().optional(),
      DEMO_VIEWER_PASSWORD: z.string().optional(),
      DEMO_PHONE_ORIGINS: z.string().default(env.NODE_ENV === "production" ? "" : "http://localhost:5174,http://localhost:5175"),
      DEMO_CAMERA_APP_URL: z.url().optional(),
      DEMO_CLASSROOM_APP_URL: z.url().optional(),
      DEVICE_ADAPTER: z.literal("simulator").default("simulator"),
      DEMO_TIME_SCALE: z.coerce.number().min(1).max(60).default(env.NODE_ENV === "production" ? 1 : 60),
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
    .safeParse(env);
  if (!parsed.success) {
    const requirements = { SESSION_SECRET: "SESSION_SECRET (at least 32 characters, no placeholder)", SERVICE_INGEST_TOKEN: "SERVICE_INGEST_TOKEN (at least 32 characters, no placeholder)", MONGODB_URI: "MONGODB_URI (required MongoDB URI in production)", ADMIN_INVITE_KEY: "ADMIN_INVITE_KEY (at least 8 characters when configured)" };
    const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join(".")))];
    throw new Error("Invalid server configuration: " + fields.map(field => requirements[field] ?? field).join(", ") + ". Values withheld.");
  }
  return validatedConfig(parsed.data, env);
}
function validatedConfig(parsed, env) {
  if (parsed.ALLOW_PHYSICAL_CONTROL)
    throw new Error(
      "No commissioned physical adapter exists; physical control must remain disabled",
    );
  if (!parsed.DEMO_MODE && parsed.DEMO_TIME_SCALE !== 1)
    throw new Error("Accelerated time is restricted to demo mode");
  const originOptions = { production: parsed.NODE_ENV === "production" };
  const frontendOrigin = deploymentOrigin(parsed.FRONTEND_ORIGIN, { ...originOptions, label: "FRONTEND_ORIGIN" });
  const publicAppUrl = deploymentOrigin(parsed.PUBLIC_APP_URL, { ...originOptions, label: "PUBLIC_APP_URL" });
  const demoPhoneOrigins = parsed.DEMO_PHONE_ORIGINS.split(",").map(v => v.trim()).filter(Boolean).map(v => deploymentOrigin(v, { ...originOptions, label: "DEMO_PHONE_ORIGINS" }));
  const phoneApp = (value, path) => {
    const url = new URL(value || path, publicAppUrl);
    deploymentOrigin(url.origin, originOptions);
    if (url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/")) throw new Error("Phone app URLs must end in / and contain no credentials, query or fragment");
    if (![frontendOrigin, publicAppUrl, ...demoPhoneOrigins].includes(url.origin)) throw new Error("Phone app URL origin must be listed in DEMO_PHONE_ORIGINS");
    return url.toString();
  };
  return {
    env: parsed.NODE_ENV,
    port: parsed.PORT,
    host: parsed.HOST,
    mongoUri: parsed.MONGODB_URI,
    sessionSecret: parsed.SESSION_SECRET,
    adminInviteKey: parsed.ADMIN_INVITE_KEY ?? null,
    ingestToken: parsed.SERVICE_INGEST_TOKEN,
    frontendOrigin,
    publicAppUrl,
    demoCameraAppUrl: phoneApp(parsed.DEMO_CAMERA_APP_URL, "/demo/cctv-camera/"),
    demoClassroomAppUrl: phoneApp(parsed.DEMO_CLASSROOM_APP_URL, "/demo/circuit-board/"),
    demoMode: parsed.DEMO_MODE,
    allowPhysicalControl: parsed.ALLOW_PHYSICAL_CONTROL,
    allowNativeControl: parsed.ALLOW_NATIVE_DEVICE_CONTROL,
    assistantDataDir: parsed.ASSISTANT_DATA_DIR,
    ocrPython: parsed.OCR_PYTHON, ocrModulePath: parsed.OCR_MODULE_PATH, ocrTessdataPath: parsed.OCR_TESSDATA_PATH,
    demoVisionPython: parsed.DEMO_VISION_PYTHON,
    enableDemoSetup: parsed.ENABLE_DEMO_SETUP,
    allowProductionDemoSeed: parsed.ALLOW_PRODUCTION_DEMO_SEED,
    demoAdminEmail: parsed.DEMO_ADMIN_EMAIL,
    demoAdminPassword: parsed.DEMO_ADMIN_PASSWORD,
    demoViewerEmail: parsed.DEMO_VIEWER_EMAIL,
    demoViewerPassword: parsed.DEMO_VIEWER_PASSWORD,
    demoPhoneOrigins,
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
