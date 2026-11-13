import { z } from "zod";
const id = z.string().trim().min(1).max(100);
const roi = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(.01).max(1), height: z.number().min(.01).max(1) }).strict().refine(v => v.x + v.width <= 1.001 && v.y + v.height <= 1.001, "ROI exceeds image");
export const meterInput = z.object({ meterId: id, epoch: id.default("initial"), name: z.string().trim().min(1).max(200), maxPowerKw: z.number().positive().max(100000) }).strict();
export const meterCameraInput = z.object({
  name: z.string().trim().min(1).max(200), meterId: id, epoch: id.default("initial"),
  intervalMinutes: z.number().int().min(1).max(1440).default(60),
  register: z.literal("import_kwh").default("import_kwh"), unit: z.enum(["kWh", "Wh"]).default("kWh"),
  registerLabel: z.string().trim().min(1).max(40).default("kWh"),
  roi: roi.default({ x: 0, y: 0, width: 1, height: 1 }), orientation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  decimalMode: z.enum(["dot", "comma", "implied"]).default("dot"), decimalPlaces: z.number().int().min(0).max(6).default(2),
  dataMode: z.enum(["live", "simulated"]).default("simulated"),
}).strict();
export const meterCameraPatch = meterCameraInput.omit({ meterId: true, epoch: true }).partial().extend({ enabled: z.boolean().optional(), autoAccept: z.boolean().optional() }).strict();
const image = z.object({ mime: z.enum(["image/jpeg", "image/png"]), image: z.string().min(20).max(350000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();
export const meterFrameInput = z.object({ captureId: id, jobId: id.optional(), capturedAt: z.iso.datetime(), images: z.array(image).min(1).max(2) }).strict();
export const meterReviewInput = z.object({ action: z.enum(["accept", "correct", "reject"]), value: z.number().nonnegative().max(1e12).optional(), reason: z.string().trim().min(5).max(1000) }).strict();
export const meterTransitionInput = z.object({ meterId: id, fromEpoch: id, newEpoch: id, type: z.enum(["reset", "replacement", "rollover"]), effectiveAt: z.iso.datetime(), reason: z.string().trim().min(5).max(1000), registerMaximum: z.number().positive().optional() }).strict().refine(v => v.fromEpoch !== v.newEpoch && (v.type !== "rollover" || v.registerMaximum), "Use a new epoch and record rollover maximum");
