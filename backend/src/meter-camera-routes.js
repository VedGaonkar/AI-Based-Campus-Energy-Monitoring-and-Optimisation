import express from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import { requireRole, fail } from "./security/access.js";
import { createMeterCameraService, meterCameraGrant } from "./services/meter-camera.js";
import { meterInput, meterCameraInput, meterCameraPatch, meterFrameInput, meterReviewInput, meterTransitionInput } from "../../shared/meter-camera-contracts.js";
import { recogniseMeter } from "./adapters/meter-ocr.js";
import { parsePatch } from "../../shared/contracts.js";
import { getSettings, audit } from "./services/context.js";

export function registerMeterPhoneRoutes(api, { models, config, origins }) {
  const phone = express.Router(), service = createMeterCameraService(models, config), allowed = new Set([...origins, ...(config.demoPhoneOrigins ?? [])]);
  phone.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
    const origin = req.get("Origin");
    if (origin && !allowed.has(origin)) fail(403, "ORIGIN_REJECTED", "Meter-phone origin is not allowed");
    if (origin) { res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin"); res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type"); res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS"); }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    if (req.method !== "GET" && !allowed.has(origin)) fail(403, "ORIGIN_REJECTED", "Meter-phone origin is not allowed");
    next();
  });
  phone.post("/pair", rateLimit({ windowMs: 60000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false }), async (req, res) => res.json({ data: await service.pair(z.object({ code: z.string().min(20).max(180) }).strict().parse(req.body).code) }));
  phone.use(async (req, _res, next) => { req.meterGrant = await meterCameraGrant(models, req.get("Authorization")?.replace(/^Bearer /, "")); next(); });
  phone.get("/state", async (req, res) => res.json({ data: await service.state(req.meterGrant, new Date(), req.query.active === "1") }));
  phone.post("/frames", rateLimit({ windowMs: 60000, limit: config.env === "test" ? 100 : 12, standardHeaders: "draft-8", legacyHeaders: false }), async (req, res) => res.status(202).json({ data: await service.capture(req.meterGrant._id, meterFrameInput.parse(req.body), `meter-camera:${req.meterGrant._id}`, { grant: req.meterGrant }) }));
  phone.post("/offline", async (req, res) => { await service.offline(req.meterGrant); res.json({ data: { offline: true } }); });
  api.use("/meter-phone", phone);
}

export function registerMeterCameraRoutes(api, { models, config }) {
  const service = createMeterCameraService(models, config), admin = req => requireRole(req.user, ["admin"]);
  api.get("/meters", async (_req, res) => res.json({ data: await service.listMeters() }));
  api.post("/meters", async (req, res) => { admin(req); res.status(201).json({ data: await service.addMeter(meterInput.parse(req.body), req.user._id) }); });
  api.get("/meter-cameras", async (req, res) => { admin(req); res.json({ data: await service.list() }); });
  api.get("/meter-ocr/health", async (req, res) => { admin(req); res.json({ data: await recogniseMeter(config, { op: "health" }) }); });
  api.post("/meter-cameras", async (req, res) => { admin(req); res.status(201).json({ data: await service.register(meterCameraInput.parse(req.body), req.user._id) }); });
  api.patch("/meter-cameras/:id", async (req, res) => { admin(req); res.json({ data: await service.update(req.params.id, parsePatch(meterCameraPatch, req.body), req.user._id) }); });
  api.post("/meter-cameras/:id/pairing", async (req, res) => { admin(req); res.json({ data: await service.issuePairing(req.params.id, req.user._id) }); });
  const ocrLimit = rateLimit({ windowMs: 60000, limit: config.env === "test" ? 100 : 12, standardHeaders: "draft-8", legacyHeaders: false });
  api.post("/meter-cameras/:id/test", ocrLimit, async (req, res) => { admin(req); res.status(202).json({ data: await service.capture(req.params.id, meterFrameInput.parse(req.body), req.user._id, { test: true }) }); });
  api.post("/meter-images", ocrLimit, async (req, res) => {
    admin(req); const { cameraId, ...body } = z.object({ cameraId: z.string().min(1).max(100) }).passthrough().parse(req.body);
    res.status(202).json({ data: await service.capture(cameraId, meterFrameInput.parse(body), req.user._id, { test: true }) });
  });
  api.get("/meter-captures", async (req, res) => { admin(req); res.json({ data: await models.MeterCapture.find(req.query.cameraId ? { cameraId: String(req.query.cameraId) } : {}).sort({ receivedAt: -1 }).limit(100).lean() }); });
  api.post("/meter-captures/:id/review", async (req, res) => { admin(req); res.json({ data: await service.review(req.params.id, meterReviewInput.parse(req.body), req.user._id) }); });
  api.get("/meter-captures/:id/images/:index", async (req, res) => {
    admin(req); const index = z.coerce.number().int().min(0).max(1).parse(req.params.index);
    const row = await models.MeterImage.findOne({ captureId: req.params.id, expiresAt: { $gt: new Date() } }).select("+frames").lean(), frame = row?.frames[index];
    if (!frame) fail(404, "IMAGE_EXPIRED", "Image expired or left the latest-12 retention window; original OCR text/digests remain");
    res.setHeader("Cache-Control", "no-store"); res.type(frame.mime).send(Buffer.from(frame.image.buffer ?? frame.image));
  });
  api.get("/meter-epoch-transitions", async (req, res) => { admin(req); res.json({ data: await models.MeterEpochTransition.find().sort({ createdAt: -1 }).limit(100).lean() }); });
  api.post("/meter-epoch-transitions", async (req, res) => {
    admin(req); const input = meterTransitionInput.parse(req.body), now = new Date();
    if (+new Date(input.effectiveAt) > +now + 300000) fail(400, "FUTURE_TIMESTAMP", "Record a transition that has already occurred");
    const previous = await models.MeterEpochTransition.findOne({ meterId: input.meterId, newEpoch: input.newEpoch }).lean();
    if (previous?.status === "completed") return res.json({ data: previous });
    if (previous) fail(409, "EPOCH_PENDING", "An interrupted epoch transition is recorded. An operator must reconcile its settings/camera state; no transition success inferred.");
    const settings = await models.Settings.findById("installation").lean(), old = settings.meters.find(row => row.meterId === input.meterId && row.epoch === input.fromEpoch);
    if (!old || old.closedAt || settings.meters.some(row => row.meterId === input.meterId && row.epoch === input.newEpoch)) fail(409, "EPOCH_CONFLICT", "Select an open original epoch and a new unused epoch");
    const last = await models.MeterReading.findOne({ meterId: input.meterId, epoch: input.fromEpoch, validationState: "accepted" }).sort({ capturedAt: -1 }).lean();
    if (last && +last.capturedAt >= +new Date(input.effectiveAt)) fail(409, "EPOCH_TIME_CONFLICT", "Transition must follow the last accepted old-epoch reading");
    const meters = settings.meters.map(row => row.meterId === input.meterId && row.epoch === input.fromEpoch ? { ...row, closedAt: input.effectiveAt } : row);
    meters.push({ ...old, epoch: input.newEpoch, startedAt: input.effectiveAt, register: "import_kwh" });
    const transition = await models.MeterEpochTransition.create({ ...input, actorId: req.user._id });
    const result = await models.Settings.updateOne({ _id: "installation", updatedAt: settings.updatedAt }, { $set: { meters } });
    if (!result.modifiedCount) fail(409, "STATE_CHANGED", "Settings changed; transition evidence retained for operator reconciliation");
    const cameras = await models.MeterCamera.find({ meterId: input.meterId, epoch: input.fromEpoch }).select("_id").lean();
    await models.MeterCamera.updateMany({ _id: { $in: cameras.map(row => row._id) } }, { $set: { enabled: false, autoAccept: false, pairedUntil: new Date(0) }, $unset: { tokenHash: "", codeHash: "" } });
    await models.MeterCaptureJob.updateMany({ cameraId: { $in: cameras.map(row => row._id) }, status: { $in: ["pending", "processing"] } }, { $set: { status: "cancelled" } });
    await audit(models, req.user._id, "meter.epoch_transition", transition._id, input.type);
    await models.MeterEpochTransition.updateOne({ _id: transition._id }, { $set: { status: "completed" } });
    res.status(201).json({ data: { ...transition.toObject(), status: "completed", note: "New baseline required; no energy inferred across the reset/rollover boundary. Register/re-pair its camera." } });
  });
}
