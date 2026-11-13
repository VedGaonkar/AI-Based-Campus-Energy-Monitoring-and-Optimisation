import { z } from "zod";
export const demoSessionInput = z.object({
  roomId: z.string().min(1).max(120),
  visionMode: z.enum(["instrumented", "camera_inference", "scenario_injection"]).default("instrumented"),
  vacancyConfirmationSeconds: z.number().int().min(2).max(60).default(5),
  durationMinutes: z.number().int().min(5).max(120).default(60),
  coverageReviewed: z.literal(true), allowManualControl: z.boolean().default(false),
}).strict();
export const pairInput = z.object({ code: z.string().trim().min(10).max(40) }).strict();
export const pairRoleInput = z.object({ role: z.enum(["camera", "classroom", "presenter"]) }).strict();
export const frameInput = z.object({
  sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  capturedAt: z.iso.datetime(), mime: z.enum(["image/jpeg", "image/png"]),
  image: z.string().min(40).max(350000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export const sceneNames = ["light", "fan", "ac", "display", "occupied", "empty_on", "empty_off"];
export const sceneInput = z.object({
  name: z.enum(sceneNames), locked: z.boolean().optional(),
  localSwitches: z.object({ light: z.boolean(), fan: z.boolean(), ac: z.boolean(), display: z.boolean() }).strict().optional(),
}).strict();
export const ackInput = z.object({ commandId: z.string().min(1).max(120), action: z.enum(["on", "off"]), applied: z.literal(true) }).strict();
export const demoSupplyInput = z.object({ requestId: z.string().uuid(), action: z.enum(["on", "off"]) }).strict();
export const injectionInput = z.object({ occupancy: z.enum(["occupied", "vacant", "unknown"]), equipmentOn: z.boolean() }).strict();
