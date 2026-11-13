import { config as dotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv({
  path: fileURLToPath(new URL("../../.env", import.meta.url)),
  quiet: true,
});
const bool = z.enum(["true", "false"]).transform((v) => v === "true");
export function loadConfig(env = process.env) {
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
      DEMO_VISION_PYTHON: z.string().min(1).default("python"),
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
      ADMIN_INVITE_KEY: z
        .string()
        .trim()
        .regex(/^\d{8}$/, "ADMIN_INVITE_KEY must be exactly 8 digits or left empty to disable admin access")
        .optional()
        .or(z.literal("").transform(() => undefined)),
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
    ingestToken: parsed.SERVICE_INGEST_TOKEN,
    frontendOrigin: parsed.FRONTEND_ORIGIN,
    publicAppUrl: parsed.PUBLIC_APP_URL,
    demoMode: parsed.DEMO_MODE,
    allowPhysicalControl: parsed.ALLOW_PHYSICAL_CONTROL,
    allowNativeControl: parsed.ALLOW_NATIVE_DEVICE_CONTROL,
    demoVisionPython: parsed.DEMO_VISION_PYTHON,
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
    adminInviteKey: parsed.ADMIN_INVITE_KEY ?? null,
  };
}
