import { randomBytes, randomUUID, createHash } from "node:crypto";
import { recogniseMeter } from "../adapters/meter-ocr.js";
import { parseMeterText, validateMeterCandidate } from "../domain/meter-ocr.js";
import { addReading, reviewReading } from "./energy.js";
import { getSettings, audit } from "./context.js";
import { fail } from "../security/access.js";
import { publishChange } from "../realtime/journal.js";
const hash = value => createHash("sha256").update(value).digest("hex");
const exists = row => { if (!row) fail(404, "NOT_FOUND", "Meter camera or capture not found"); return row; };
const safeCamera = ({ codeHash, tokenHash, processingOwner, processingUntil, ...row }) => row;
const milliseconds = camera => camera.intervalMinutes * 60000;

export async function maintainMeterCameras(models, now = new Date()) {
  await models.MeterImage.deleteMany({ expiresAt: { $lte: now } });
  const excess = await models.MeterImage.find().sort({ createdAt: -1 }).skip(192).select("_id").lean();
  if (excess.length) await models.MeterImage.deleteMany({ _id: { $in: excess.map(row => row._id) } });
  await models.MeterCapture.updateMany({ status: "processing", processingUntil: { $lt: now } }, { $set: { status: "needs_review" }, $push: { reviews: { at: now, action: "processing_interrupted", reason: "Backend stopped; no OCR/reading success inferred" } } });
  await models.MeterCaptureJob.updateMany({ status: { $in: ["pending", "processing"] }, expiresAt: { $lte: now } }, { $set: { status: "missed", finishedAt: now } });
  for (const camera of await models.MeterCamera.find({ enabled: true, nextCaptureAt: { $lte: now } }).lean()) {
    const slot = camera.nextCaptureAt, expiresAt = new Date(+slot + Math.min(milliseconds(camera), 600000));
    const jobId = `${camera._id}:${+slot}`;
    await models.MeterCaptureJob.updateOne({ _id: jobId }, { $setOnInsert: { cameraId: camera._id, slotAt: slot, expiresAt, revision: camera.revision, status: +expiresAt > +now ? "pending" : "missed" } }, { upsert: true });
    // Advance once from current time. Do not enqueue/replay a backlog after loss.
    await models.MeterCamera.updateOne({ _id: camera._id, nextCaptureAt: slot }, { $set: { nextCaptureAt: new Date(+now + milliseconds(camera)) } });
  }
}
export async function meterCameraGrant(models, token, now = new Date()) {
  const prefix = `${models.institutionId ?? "legacy"}.`;
  if (typeof token !== "string" || !token.startsWith(prefix) || token.length > 180) fail(401, "METER_PAIR_REQUIRED", "Pair this meter camera again");
  const camera = await models.MeterCamera.findOne({ tokenHash: hash(token.slice(prefix.length)), pairedUntil: { $gt: now }, enabled: true }).lean();
  if (!camera) fail(401, "METER_PAIR_REQUIRED", "Meter-camera capability is expired, revoked or invalid");
  return camera;
}
export function createMeterCameraService(models, config) {
  async function camera(id) { return exists(await models.MeterCamera.findById(id).lean()); }
  async function meter(meterId, epoch) {
    const row = (await getSettings(models)).meters.find(row => row.meterId === meterId && row.epoch === epoch);
    if (!row) fail(400, "UNKNOWN_METER_EPOCH", "Select an existing configured meter and epoch");
    return row;
  }
  async function accept(capture, value, actorId, reason, automatic = false) {
    if (!Number.isFinite(value) || value < 0) fail(400, "READING_REQUIRED", "Enter a reviewed non-negative cumulative kWh value");
    if (+capture.capturedAt > Date.now() + 300000) fail(409, "FUTURE_TIMESTAMP", "Reject or wait for this capture's future timestamp; do not rewrite its original evidence");
    const input = { eventId: `ocr-${capture._id}`, meterId: capture.meterId, epoch: capture.epoch, register: "import_kwh", kind: "cumulative", unit: "kWh", value,
      capturedAt: capture.capturedAt.toISOString(), sourceType: "camera_ocr", dataMode: capture.dataMode,
      quality: { ocrConfidence: capture.validation?.confidence ?? 0, registerMatched: capture.validation?.registerMatched ?? false, burstAgreement: capture.validation?.burstAgreement ?? false } };
    const original = !automatic && await models.MeterReading.findOne({ eventId: input.eventId }).lean();
    const result = original ? { reading: await reviewReading(models, original._id, { value, reason }, actorId, config), duplicate: true } : await addReading(models, input, actorId, config, automatic ? {} : { refresh: false, initialReviewReason: "Meter-camera value awaits authorised visual review" });
    let reading = result.reading;
    if (!automatic && reading.validationState !== "accepted") reading = await reviewReading(models, reading._id, { value, reason }, actorId, config);
    if (reading.validationState !== "accepted") return null;
    await models.MeterCapture.updateOne({ _id: capture._id }, { $set: { status: "accepted", readingId: reading._id, reviewedValue: value }, $push: { reviews: { at: new Date(), actorId, action: automatic ? "automatic_accept" : "accept", value, reason, duplicateReading: result.duplicate } } });
    return reading;
  }
  return {
    async listMeters() { return (await getSettings(models)).meters; },
    async addMeter(input, actorId) {
      const settings = await getSettings(models);
      if (settings.meters.some(row => row.meterId === input.meterId)) fail(409, "METER_EXISTS", "Select the existing meter; use its recorded reset/replacement procedure for another epoch");
      if (settings.meters.length >= 20) fail(409, "METER_LIMIT", "Pilot limit is 20 meter epochs; review retention/deployment capacity");
      const row = { ...input, register: "import_kwh", unit: "kWh" };
      const updated = await models.Settings.updateOne({ _id: "installation", "meters.meterId": { $ne: input.meterId } }, { $push: { meters: row } });
      if (!updated.modifiedCount) fail(409, "METER_EXISTS", "Meter was already configured");
      await audit(models, actorId, "meter.register", input.meterId); return row;
    },
    async register(input, actorId) {
      const configured = await meter(input.meterId, input.epoch);
      if (configured.closedAt) fail(409, "EPOCH_CLOSED", "Register a camera against the current open meter epoch");
      if (await models.MeterCamera.countDocuments({ enabled: true }) >= 16) fail(409, "CAMERA_LIMIT", "Pilot limit is 16 active meter cameras");
      const row = await models.MeterCamera.create({ ...input, dataMode: config.demoMode ? "simulated" : input.dataMode, nextCaptureAt: new Date(), createdBy: actorId, updatedBy: actorId });
      await audit(models, actorId, "meter_camera.register", row._id); return safeCamera(row.toObject());
    },
    async list(now = new Date()) {
      const rows = await models.MeterCamera.find().sort({ createdAt: -1 }).lean();
      return Promise.all(rows.map(async row => ({ ...safeCamera(row), health: !row.enabled ? "disabled" : row.offlineAt && +row.offlineAt >= +(row.lastSeenAt ?? 0) || !row.lastSeenAt || +now - +row.lastSeenAt > 30000 ? "offline" : row.captureActive ? "online" : "stopped",
        lastAcceptedAt: (await models.MeterReading.findOne({ meterId: row.meterId, epoch: row.epoch, validationState: "accepted" }).sort({ capturedAt: -1 }).lean())?.capturedAt ?? null,
        needsReview: await models.MeterCapture.countDocuments({ cameraId: row._id, status: "needs_review" }), missedCaptures: await models.MeterCaptureJob.countDocuments({ cameraId: row._id, status: "missed" }) })));
    },
    async update(id, patch, actorId) {
      const row = await camera(id), { autoAccept, ...fields } = patch;
      if (row.processingUntil && +row.processingUntil > Date.now()) fail(409, "CAMERA_BUSY", "Wait for the active OCR capture before changing its configuration");
      if (autoAccept === true) {
        if (Object.keys(fields).length) fail(409, "TEST_REQUIRED", "Save configuration, test/review a capture, then enable automatic acceptance separately");
        if (!await models.MeterCapture.exists({ cameraId: id, status: "accepted", "configSnapshot.revision": row.revision, "validation.eligible": true, $expr: { $eq: ["$candidateKwh", "$reviewedValue"] } })) fail(409, "TEST_REQUIRED", "A clear agreeing two-frame test in this exact configuration must match the visually accepted value first");
      }
      const revisionChanged = Object.keys(fields).length > 0;
      if (fields.enabled === true && (await meter(row.meterId, row.epoch)).closedAt) fail(409, "EPOCH_CLOSED", "Old meter epoch is closed");
      const update = { ...fields, ...(autoAccept === undefined ? {} : { autoAccept }), updatedBy: actorId,
        ...(revisionChanged ? { autoAccept: false, nextCaptureAt: new Date() } : {}) };
      if (fields.enabled === false) { update.tokenHash = undefined; update.pairedUntil = new Date(0); }
      await models.MeterCamera.updateOne({ _id: id }, { $set: update, ...(revisionChanged ? { $inc: { revision: 1 } } : {}) });
      if (revisionChanged) await models.MeterCaptureJob.updateMany({ cameraId: id, status: { $in: ["pending", "processing"] } }, { $set: { status: "cancelled" } });
      await audit(models, actorId, "meter_camera.configure", id); return safeCamera(await camera(id));
    },
    async issuePairing(id, actorId) {
      const row = await camera(id); if (!row.enabled) fail(409, "CAMERA_DISABLED", "Enable this camera before pairing");
      const code = randomBytes(24).toString("base64url"), codeExpiresAt = new Date(Date.now() + 300000);
      await models.MeterCamera.updateOne({ _id: id }, { $set: { codeHash: hash(code), codeExpiresAt, pairedUntil: new Date(0) }, $unset: { tokenHash: "" }, $inc: { generation: 1 } });
      await audit(models, actorId, "meter_camera.pairing_issued", id);
      return { code: `${models.institutionId ?? "legacy"}.${code}`, expiresAt: codeExpiresAt, url: `${config.publicAppUrl}/demo/meter-camera/#pair=${models.institutionId ?? "legacy"}.${code}` };
    },
    async pair(code) {
      const prefix = `${models.institutionId ?? "legacy"}.`, token = randomBytes(32).toString("base64url"), now = new Date(), expiresAt = new Date(+now + 86400000);
      if (!code.startsWith(prefix)) fail(401, "METER_PAIR_REQUIRED", "Invalid meter-camera pairing");
      const row = await models.MeterCamera.findOneAndUpdate({ codeHash: hash(code.slice(prefix.length)), codeExpiresAt: { $gt: now }, enabled: true }, { $unset: { codeHash: "", codeExpiresAt: "", offlineAt: "" }, $set: { tokenHash: hash(token), pairedUntil: expiresAt, lastSeenAt: now } }, { returnDocument: "after" }).lean();
      if (!row) fail(401, "METER_PAIR_REQUIRED", "Pairing is invalid, expired or already used");
      return { token: `${prefix}${token}`, cameraId: row._id, expiresAt, purpose: "meter" };
    },
    async state(grant, now = new Date(), active = false) {
      await maintainMeterCameras(models, now);
      await models.MeterCamera.updateOne({ _id: grant._id, generation: grant.generation }, { $set: { lastSeenAt: now, captureActive: active }, ...(active ? { $unset: { offlineAt: "" } } : {}) });
      const current = await camera(grant._id), job = await models.MeterCaptureJob.findOne({ cameraId: grant._id, revision: current.revision, status: "pending", expiresAt: { $gt: now } }).sort({ slotAt: -1 }).lean();
      return { camera: safeCamera(current), request: job ? { id: job._id, slotAt: job.slotAt, expiresAt: job.expiresAt } : null, serverTime: now };
    },
    async offline(grant) { await models.MeterCamera.updateOne({ _id: grant._id, generation: grant.generation }, { $set: { offlineAt: new Date(), captureActive: false } }); },
    async capture(id, input, actorId, { grant, test = false, now = new Date() } = {}) {
      const row = await camera(id);
      if (!row.enabled) fail(409, "CAMERA_DISABLED", "This meter camera is disabled");
      const previousCapture = await models.MeterCapture.findOne({ cameraId: id, captureId: input.captureId }).lean();
      if (previousCapture) {
        if (+previousCapture.capturedAt !== +new Date(input.capturedAt) || JSON.stringify(previousCapture.imageDigests) !== JSON.stringify(input.images.map(frame => hash(Buffer.from(frame.image, "base64"))))) fail(409, "CAPTURE_CONFLICT", "Capture identifier already belongs to different original evidence");
        return { ...previousCapture, duplicate: true };
      }
      const owner = randomUUID(), lock = await models.MeterCamera.findOneAndUpdate({ _id: id, ...(grant ? { generation: grant.generation, pairedUntil: { $gt: now } } : {}), $or: [{ processingUntil: { $exists: false } }, { processingUntil: { $lt: now } }] }, { $set: { processingOwner: owner, processingUntil: new Date(+now + 20000) } }, { returnDocument: "after" }).lean();
      if (!lock) fail(409, "CAMERA_BUSY", "Capture is busy or its pairing was replaced");
      let capture;
      try {
        if (!test) {
          if (!input.jobId) fail(400, "CAPTURE_JOB_REQUIRED", "Wait for a current backend capture request");
          const job = await models.MeterCaptureJob.findOneAndUpdate({ _id: input.jobId, cameraId: id, revision: row.revision, status: "pending", slotAt: { $lte: now }, expiresAt: { $gt: now } }, { $set: { status: "processing", captureId: input.captureId } }, { returnDocument: "after" }).lean();
          if (!job) fail(409, "CAPTURE_EXPIRED", "Capture request was completed, replaced or expired; no backlog replay");
        }
        const bytes = input.images.map(frame => ({ mime: frame.mime, image: Buffer.from(frame.image, "base64") }));
        if (bytes.some(frame => frame.image.length > 256000)) fail(413, "IMAGE_LIMIT", "Each image must be at most 250KB");
        const digests = bytes.map(frame => hash(frame.image));
        const repeatedImage = await models.MeterCapture.exists({ cameraId: id, imageDigests: { $in: digests } });
        capture = await models.MeterCapture.create({ cameraId: id, captureId: input.captureId, jobId: input.jobId, meterId: row.meterId, epoch: row.epoch, capturedAt: new Date(input.capturedAt), receivedAt: now, configSnapshot: row,
          imageDigests: digests, sourceType: grant ? "paired_meter_phone" : "admin_image_upload", dataMode: config.demoMode ? "simulated" : row.dataMode, status: "processing", processingUntil: new Date(+now + 20000) });
        // Keep at most 12 image pairs/camera; metadata/text/corrections persist.
        const retained = await models.MeterImage.find({ cameraId: id }).sort({ createdAt: -1 }).skip(11).select("_id").lean();
        if (retained.length) await models.MeterImage.deleteMany({ _id: { $in: retained.map(item => item._id) } });
        const excess = await models.MeterImage.find().sort({ createdAt: -1 }).skip(191).select("_id").lean();
        if (excess.length) await models.MeterImage.deleteMany({ _id: { $in: excess.map(item => item._id) } });
        await models.MeterImage.create({ captureId: capture._id, cameraId: id, frames: bytes, expiresAt: new Date(+now + 86400000) });
        let evidence, reasons = [], parsed = [];
        try { evidence = await recogniseMeter(config, { images: input.images, configuration: row }); parsed = evidence.frames.map(frame => parseMeterText(frame.text, row)); }
        catch (error) { evidence = { error: error.code ?? "OCR_UNAVAILABLE", frames: [] }; reasons.push(evidence.error); }
        const value = parsed[0]?.value ?? null;
        for (const result of parsed) reasons.push(...result.reasons);
        const burstAgreement = parsed.length === 2 && value !== null && parsed.every(result => result.value === value && !result.reasons.length);
        const confidence = evidence.frames.length ? Math.min(...evidence.frames.map(frame => frame.confidence)) : 0;
        if (!burstAgreement) reasons.push("BURST_NOT_CONFIRMED"); if (confidence < .9) reasons.push("OCR_CONFIDENCE_REVIEW");
        if (repeatedImage) reasons.push("REPEATED_IMAGE");
        const accepted = await models.MeterReading.find({ meterId: row.meterId, epoch: row.epoch, register: "import_kwh", kind: "cumulative", dataMode: capture.dataMode, validationState: "accepted" }).sort({ capturedAt: 1 }).lean();
        const before = accepted.filter(reading => +reading.capturedAt < +capture.capturedAt).at(-1), after = accepted.find(reading => +reading.capturedAt > +capture.capturedAt);
        const configured = await meter(row.meterId, row.epoch);
        reasons.push(...validateMeterCandidate({ value, capturedAt: capture.capturedAt, receivedAt: now, previous: before, next: after, maxPowerKw: configured.maxPowerKw ?? 100 }));
        if (configured.closedAt && +capture.capturedAt >= +new Date(configured.closedAt) || configured.startedAt && +capture.capturedAt < +new Date(configured.startedAt)) reasons.push("METER_EPOCH_MISMATCH");
        const conflict = accepted.find(reading => +reading.capturedAt === +capture.capturedAt && reading.value !== value); if (conflict) reasons.push("TIMESTAMP_CONFLICT");
        reasons = [...new Set(reasons)];
        const validation = { reasons, eligible: !reasons.length, confidence, burstAgreement, registerMatched: parsed.length > 0 && parsed.every(value => value.registerMatched) };
        // Set immutable original OCR fields exactly once, using a guarded raw
        // update because Mongoose correctly refuses later evidence mutation.
        await models.MeterCapture.collection.updateOne({ _id: capture._id, status: "processing", evidence: { $exists: false } }, { $set: { evidence, candidateKwh: value, validation, status: "needs_review" } });
        await publishChange(models.MeterCapture.db, { resource: "meter-captures", entityId: capture._id, adminOnly: true, operation: "ocr_completed" });
        capture = await models.MeterCapture.findById(capture._id).lean();
        if (!test && row.autoAccept && validation.eligible && await models.MeterCamera.exists({ _id: id, revision: row.revision, enabled: true, autoAccept: true, ...(grant ? { generation: grant.generation, pairedUntil: { $gt: new Date() } } : {}) })) {
          try { await accept(capture, value, actorId, "Reviewed camera configuration; clear agreeing burst and validation", true); }
          catch { await models.MeterCapture.updateOne({ _id: capture._id }, { $push: { reviews: { at: now, action: "automatic_accept_blocked", reason: "Current reading constraints require review" } } }); }
        }
        await models.MeterCamera.updateOne({ _id: id }, { $set: { lastCaptureAt: now, lastError: evidence.error ?? "" } });
        if (input.jobId) await models.MeterCaptureJob.updateOne({ _id: input.jobId, cameraId: id }, { $set: { status: "completed", finishedAt: new Date() } });
        await audit(models, actorId, "meter_camera.ocr", capture._id, capture.dataMode);
        return await models.MeterCapture.findById(capture._id).lean();
      } finally { await models.MeterCamera.updateOne({ _id: id, processingOwner: owner }, { $unset: { processingOwner: "", processingUntil: "" } }); }
    },
    async review(id, input, actorId) {
      const row = exists(await models.MeterCapture.findById(id).lean());
      if (row.status === "processing") fail(409, "OCR_PENDING", "Wait for OCR to finish or its processing lease to expire");
      if (input.action === "reject") {
        if (row.status === "accepted") fail(409, "ACCEPTED_READING", "Use an audited reading correction for an already accepted capture");
        await models.MeterCapture.updateOne({ _id: id }, { $set: { status: "rejected" }, $push: { reviews: { ...input, actorId, at: new Date() } } });
      }
      else {
        const value = input.action === "correct" ? input.value : row.candidateKwh;
        if (row.status === "accepted") {
          if (input.action !== "correct") return row;
          const reading = await reviewReading(models, row.readingId, { value, reason: input.reason }, actorId, config);
          await models.MeterCapture.updateOne({ _id: id }, { $set: { reviewedValue: value }, $push: { reviews: { ...input, actorId, at: new Date(), readingId: reading._id } } });
        } else await accept(row, value, actorId, input.reason);
      }
      await audit(models, actorId, "meter_camera.review", id, input.action); return models.MeterCapture.findById(id).lean();
    },
  };
}
