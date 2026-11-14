import { z } from "zod";

export const roles = ["admin", "hod", "technician", "teacher", "viewer"];
export const id = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);
export const timestamp = z.iso.datetime({ offset: true });
const text = z.string().trim().min(1).max(200);
export const loginInput = z
  .object({ email: z.email().max(200), password: z.string().min(1).max(200) })
  .strict();
export const roomInput = z
  .object({
    code: text.max(30),
    name: text,
    floorId: id.nullable().default(null),
    spaceType: z.enum(["classroom", "laboratory", "office", "meeting", "washroom", "corridor", "other"]).default("classroom"),
    cameraConfiguration: z.enum(["installed", "planned", "none", "offline"]).default("none"),
    capacity: z.number().int().nonnegative().default(0),
    roomBreakerId: id,
    controlMode: z.enum(["alert_only", "simulated"]).default("alert_only"),
    nativeOffMode: z.enum(["alert_only", "simulated", "live"]).default("alert_only"),
    coverageValidated: z.boolean().default(false),
    independentInfrastructure: z.boolean().default(false),
    requiredSourceIds: z.array(id).max(20).default([]),
    firstResponderId: id.nullable().default(null),
    secondResponderId: id.nullable().default(null),
    backupResponderId: id.nullable().default(null),
    allowedStartHour: z.number().int().min(0).max(23).default(7),
    allowedEndHour: z.number().int().min(1).max(24).default(22),
  })
  .strict()
  .refine(
    (v) => v.allowedEndHour > v.allowedStartHour,
    "Allowed hours must form a same-day interval",
  );
export const deviceInput = z
  .object({
    roomId: id,
    name: text,
    category: z.enum(["lighting", "fan", "socket", "ac", "other"]),
    ratedWatts: z.number().min(0).max(100000),
    essential: z.boolean().default(false),
    supplyInterruptionApproved: z.boolean().default(false),
    requiresNormalStopBeforeCutoff: z.boolean().default(false),
    stopProcedureConfirmedAt: timestamp.nullable().default(null),
    restartDelaySeconds: z.number().int().min(0).max(3600).default(180),
    restartBehaviourKnown: z.boolean().default(false),
    essentialStandbyRequirement: z.boolean().default(false),
    approvalNotes: z.string().max(1000).default(""),
    nativeOffRequired: z.boolean().default(false),
  })
  .strict();
export const scheduleInput = z
  .object({
    roomId: id,
    startAt: timestamp,
    endAt: timestamp,
    title: text,
    status: z.enum(["confirmed", "cancelled"]).default("confirmed"),
  })
  .strict()
  .refine(
    (v) => Date.parse(v.endAt) > Date.parse(v.startAt),
    "End must follow start",
  );
export const readingInput = z
  .object({
    eventId: id,
    meterId: id,
    epoch: id.default("initial"),
    kind: z.enum(["cumulative", "interval"]).default("cumulative"),
    register: z.literal("import_kwh").default("import_kwh"),
    value: z.number().nonnegative(),
    unit: z.literal("kWh").default("kWh"),
    capturedAt: timestamp,
    intervalStart: timestamp.optional(),
    sourceType: z
      .enum(["manual", "csv", "camera_ocr", "telemetry"])
      .default("manual"),
    dataMode: z.enum(["live", "simulated"]).default("live"),
    quality: z
      .object({
        ocrConfidence: z.number().min(0).max(1).optional(),
        registerMatched: z.boolean().optional(),
        burstAgreement: z.boolean().optional(),
      })
      .default({}),
  })
  .strict()
  .refine(
    (v) =>
      v.kind !== "interval" ||
      (v.intervalStart &&
        Date.parse(v.intervalStart) < Date.parse(v.capturedAt)),
    "Interval requires an earlier start",
  );
export const observationInput = z
  .object({
    eventId: id,
    sourceId: id,
    roomId: id,
    capturedAt: timestamp,
    sourceType: z.enum(["camera", "presence"]),
    occupancy: z.enum(["occupied", "vacant", "unknown"]),
    detectedPeople: z.number().int().min(0).optional(),
    confidence: z.number().min(0).max(1),
    coverageValidated: z.boolean(),
    quality: z.object({
      usable: z.boolean(),
      reason: z.string().max(300).nullable().default(null),
    }),
    dataMode: z.enum(["live", "simulated", "replay"]),
    modelVersion: text,
  })
  .strict();
export const leaseInput = z
  .object({
    durationMinutes: z.number().int().min(1).max(120),
    acceptedPolicy: z.literal(true),
  })
  .strict();
export const commandInput = z
  .object({
    requestId: id,
    action: z.enum(["on", "off"]),
    reason: z.enum([
      "staff_override",
      "qr_access",
      "occupancy_restore",
      "vacancy_escalation",
    ]),
    expiresAt: timestamp.optional(),
  })
  .strict();
export const settingsInput = z
  .object({
    installationName: text.optional(),
    tariff: z.number().min(0).max(1000).optional(),
    initialBaselineKwh: z.number().min(0).max(10000).nullable().optional(),
    absoluteExcessFloorKwh: z.number().min(0).max(1000).optional(),
    relativeThreshold: z.number().min(0).max(10).optional(),
    minimumBaselineSamples: z.number().int().min(2).max(100).optional(),
    holidays: z
      .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .max(366)
      .optional(),
    monthlySoftwareCost: z.number().nonnegative().optional(),
    monthlyMaintenanceCost: z.number().nonnegative().optional(),
    addedSystemCost: z.number().nonnegative().optional(),
    installedCost: z.number().nonnegative().optional(),
    meters: z
      .array(
        z
          .object({
            meterId: id,
            epoch: id,
            maxPowerKw: z.number().positive().max(10000),
            register: z.literal("import_kwh"),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(
        (rows) =>
          new Set(rows.map((r) => `${r.meterId}:${r.epoch}`)).size ===
          rows.length,
        "Meter/epoch pairs must be unique",
      )
      .optional(),
  })
  .strict();
export const errorEnvelope = (code, message, requestId, details) => ({
  error: { code, message, requestId, ...(details ? { details } : {}) },
});

// Zod 4 applies nested defaults even inside optional fields. A PATCH must
// update only explicitly supplied keys, never reset omitted policy fields.
export function parsePatch(schema, input) {
  const parsed = z.strictObject(schema.shape).partial().parse(input);
  return Object.fromEntries(Object.keys(input).map(key => [key, parsed[key]]));
}
