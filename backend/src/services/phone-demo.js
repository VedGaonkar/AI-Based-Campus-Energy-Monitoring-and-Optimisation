import { randomBytes, randomUUID, createHash, createHmac } from "node:crypto";
import QRCode from "qrcode";
import { withRoomLock, fail, equalSecret } from "../security/access.js";
import { audit, roomContext, cancelRoomWork } from "./context.js";
import { createDemoVision } from "../adapters/demo-vision.js";
import { createRoomMaster } from "../adapters/room-master.js";
import { acknowledgeClassroom, classroomCommands } from "../adapters/demo-classroom.js";
import { effectiveEquipment, demoEndpointOnline } from "./demo-session-state.js";
import { demoRoomUnavailable } from "./demo-room-availability.js";

const hash = value => createHash("sha256").update(value).digest("hex");
const gate = config => {
  if (!config.demoMode || config.allowPhysicalControl || config.deviceAdapter !== "simulator") fail(409, "DEMO_DISABLED", "Phone demonstrations require server demo mode and simulated room masters");
};
const found = item => { if (!item) fail(404, "NOT_FOUND", "Demo session not found"); return item; };
export function safeDemoSession(session) {
  const { previousRoom, thumbnail, frameOwner, frameBusyUntil, ...safe } = session; return safe;
}
export async function demoGrant(models, config, token, now = new Date(), touch = true) {
  gate(config);
  if (typeof token !== "string" || token.length < 30 || token.length > 100) fail(401, "PAIR_REQUIRED", "Pair this phone with a current session");
  const client = await models.DemoClient.findOne({ tokenHash: hash(token), pairedAt: { $ne: null }, expiresAt: { $gt: now } }).lean();
  const session = client && await models.DemoSession.findOne({ _id: client.sessionId, roomId: client.roomId, active: true, expiresAt: { $gt: now } }).lean();
  if (!client || !session) fail(401, "PAIR_EXPIRED", "Pairing expired or session ended; ask the administrator to pair again");
  if (touch) { await models.DemoClient.updateOne({ _id: client._id, tokenHash: hash(token) }, { $set: { lastSeenAt: now }, $unset: { offlineAt: "" } }); client.lastSeenAt = now; client.offlineAt = null; }
  return { ...client, session };
}
async function signedMarker(models, config, session) {
  const breaker = await models.Breaker.findOne({ roomId: session.roomId }).lean();
  const equipment = effectiveEquipment(session.scene, breaker?.reportedSupply);
  const bits = ["light", "fan", "ac", "display"].reduce((value, key, i) => value | (equipment[key] ? (1 << i) : 0), 0);
  // Compact display tag keeps cells large on a phone. The signature still binds
  // the complete UUID, so matching a short tag cannot cross session boundaries.
  const payload = `CE1|${session._id.slice(0, 8)}|${session.markerEpoch}|${session.scene.name === "occupied" ? 1 : 0}|${bits}`;
  const signature = createHmac("sha256", config.sessionSecret).update(`demo-marker:${session._id}:${payload}`).digest("base64url").slice(0, 18);
  const markerDataUrl = await QRCode.toDataURL(`${payload}|${signature}`, { width: 360, margin: 4, errorCorrectionLevel: "M" });
  await models.DemoSession.updateOne({ _id: session._id, active: true, markerEpoch: session.markerEpoch }, { $set: { markerDataUrl } });
  return markerDataUrl;
}
function decodeMarker(config, session, marker) {
  const parts = String(marker ?? "").split("|");
  if (parts.length !== 6 || parts[0] !== "CE1" || parts[1] !== session._id.slice(0, 8) || Number(parts[2]) !== session.markerEpoch || !/^[01]$/.test(parts[3]) || !/^(?:[0-9]|1[0-5])$/.test(parts[4])) return null;
  const signature = createHmac("sha256", config.sessionSecret).update(`demo-marker:${session._id}:${parts.slice(0, 5).join("|")}`).digest("base64url").slice(0, 18);
  if (!equalSecret(signature, parts[5])) return null;
  return { occupancy: parts[3] === "1" ? "occupied" : "vacant", equipment: Object.fromEntries(["light", "fan", "ac", "display"].map((key, i) => [key, !!(Number(parts[4]) & (1 << i))])) };
}

export async function stopPhoneDemo(models, config, id, actorId, now = new Date()) {
  const session = found(await models.DemoSession.findById(id).lean());
  if (!session.active) return safeDemoSession(session);
  return withRoomLock(models, session.roomId, async room => {
    await models.DemoSession.updateOne({ _id: id, active: true }, { $set: { active: false, endedAt: now, stoppedBy: actorId }, $unset: { thumbnail: "", markerDataUrl: "", thumbnailExpiresAt: "" } });
    await models.DemoClient.updateMany({ sessionId: id }, { $unset: { tokenHash: "", codeHash: "" }, $set: { expiresAt: now, offlineAt: now } });
    await models.Integration.updateOne({ _id: session.sourceId }, { $set: { health: "offline" } });
    await cancelRoomWork(models, session.roomId, "Phone demo session ended", now);
    for (const state of ["pending", "sent"]) await models.Command.updateMany({ demoSessionId: id, state }, {
      $set: { state: state === "sent" ? "unverified" : "cancelled", result: { verification: "unknown", dataMode: "simulated", reason: "Demo session ended" } },
      $push: { timeline: { at: now, event: "session_ended" } },
    });
    if (room.demoSessionId === id) await models.Room.updateOne({ _id: room._id }, { $set: { ...session.previousRoom, policyVersion: room.policyVersion + 1 }, $unset: { demoSessionId: "" } });
    await audit(models, actorId, "demo.session_stopped", id, "Pairing revoked and work cancelled; supply not automatically changed");
    return safeDemoSession({ ...session, active: false, endedAt: now });
  }, now);
}

export function createPhoneDemoService(models, config) {
  const vision = createDemoVision(config);
  const getSession = async (id, now = new Date()) => found(await models.DemoSession.findOne({ _id: id, active: true, expiresAt: { $gt: now } }).lean());
  async function observe(session, data, capturedAt, sequence, now, cameraClient) {
    return withRoomLock(models, session.roomId, async room => {
      const current = await getSession(session._id, now);
      if (cameraClient && !await models.DemoClient.exists({ _id: cameraClient._id, generation: cameraClient.generation, pairedAt: cameraClient.pairedAt, captureActive: true })) fail(409, "CAMERA_STOPPED", "Camera stopped or was re-paired before observation persistence");
      if (room.demoSessionId !== current._id) fail(409, "DEMO_REPLACED", "Room is no longer assigned to this demo");
      const observation = { eventId: `${current._id}:${cameraClient?.generation ?? "injection"}:${sequence}`, sourceId: current.sourceId, roomId: room._id, capturedAt,
        receivedAt: now, sourceType: "camera", occupancy: data.occupancy, confidence: data.occupancy === "unknown" ? 0 : 1,
        detectedPeople: data.occupancy === "occupied" ? (data.people?.length || 1) : data.occupancy === "vacant" ? 0 : undefined,
        coverageValidated: current.coverageReviewed, quality: { usable: !!data.usable && data.occupancy !== "unknown", reason: data.reason,
          confidenceMeaning: "Policy evidence gate, not calibrated occupancy probability", detectorScores: data.people?.slice(0, 30).map(person => person.score) },
        dataMode: "simulated", modelVersion: data.modelVersion, equipment: data.equipment,
        evidenceSource: data.source, demoSessionId: current._id };
      await models.Observation.create(observation);
      await models.Integration.updateOne({ _id: current.sourceId }, { $set: { health: "online", lastSeenAt: now } });
      await models.DemoSession.updateOne({ _id: current._id, active: true }, { $set: { latestObservation: { ...observation, processingMs: data.processingMs } } });
      if (observation.occupancy !== "vacant") await cancelRoomWork(models, room._id, `Phone vision: ${observation.occupancy}`, now);
      return observation;
    }, now);
  }
  return {
    async availableRooms() {
      const [rooms, breakers, devices] = await Promise.all([models.Room.find().sort({ code: 1 }).lean(), models.Breaker.find().lean(), models.Device.find().lean()]);
      return rooms.map(room => ({ _id: room._id, code: room.code, name: room.name,
        unavailableReason: demoRoomUnavailable(room, breakers.find(item => item._id === room.roomBreakerId), devices.filter(item => item.roomId === room._id)) }));
    },
    async create(input, actorId, now = new Date()) {
      gate(config);
      const visionHealth = input.visionMode === "scenario_injection" ? null : await vision.process({ mode: "health" });
      return withRoomLock(models, input.roomId, async room => {
        const breaker = await models.Breaker.findById(room.roomBreakerId).lean();
        const inventory = await models.Device.find({ roomId: room._id }).lean();
        const unavailableReason = demoRoomUnavailable(room, breaker, inventory);
        if (unavailableReason) fail(409, "DEMO_ROOM_BUSY", unavailableReason);
        const id = randomUUID(), sourceId = `phone-camera-${id}`;
        const previousRoom = Object.fromEntries(["controlMode", "coverageValidated", "requiredSourceIds", "cameraConfiguration", "demoScenario", "demoUntil"].map(key => [key, room[key] ?? (key === "requiredSourceIds" ? [] : null)]));
        const session = (await models.DemoSession.create({ _id: id, roomId: room._id, createdBy: actorId, expiresAt: new Date(+now + input.durationMinutes * 60000),
          visionMode: input.visionMode, visionVersion: visionHealth?.modelVersion, coverageReviewed: input.coverageReviewed, allowManualControl: input.allowManualControl,
          vacancyConfirmationMs: input.vacancyConfirmationSeconds * 1000, firstEscalationMs: 10000, finalAdditionalMs: 15000,
          sourceId, previousRoom, scene: { name: "empty_on", locked: false, localSwitches: { light: true, fan: true, ac: true, display: true } } })).toObject();
        try {
          await cancelRoomWork(models, room._id, "Administrator started a scoped phone demonstration", now);
          await models.Integration.create({ _id: sourceId, roomId: room._id, type: "camera", name: "Phone camera — demo CCTV", health: "offline", coverageValidated: true, freshnessSeconds: 4, capabilities: { demoSessionId: id, dataMode: "simulated" } });
          await models.Room.updateOne({ _id: room._id }, { $set: { demoSessionId: id, controlMode: "simulated", cameraConfiguration: "installed", coverageValidated: true, requiredSourceIds: [sourceId], demoScenario: null, demoUntil: null }, $inc: { policyVersion: 1 } });
          session.markerDataUrl = await signedMarker(models, config, session);
        } catch (error) {
          await models.DemoSession.updateOne({ _id: id }, { $set: { active: false, endedAt: now } });
          await models.Integration.updateOne({ _id: sourceId }, { $set: { health: "offline" } });
          await models.Room.updateOne({ _id: room._id, demoSessionId: id }, { $set: previousRoom, $unset: { demoSessionId: "" } });
          throw error;
        }
        await audit(models, actorId, "demo.session_created", id, `${input.visionMode}; simulated only, 10s/15s escalation`);
        return safeDemoSession(session);
      }, now);
    },
    async issuePairing(id, role, actorId, now = new Date()) {
      gate(config); const session = await getSession(id, now), code = randomBytes(12).toString("base64url");
      const codeExpiresAt = new Date(Math.min(+session.expiresAt, +now + 300000));
      await models.DemoClient.findOneAndUpdate({ sessionId: id, role }, { $set: { roomId: session.roomId, codeHash: hash(code), codeExpiresAt, expiresAt: session.expiresAt, lastSequence: -1, captureActive: false }, $inc: { generation: 1 }, $unset: { tokenHash: "", pairedAt: "", lastSeenAt: "", offlineAt: "" } }, { upsert: true });
      await audit(models, actorId, "demo.pairing_issued", id, `Scoped ${role} role; code expires within five minutes`);
      const path = role === "camera" ? "cctv-camera" : "circuit-board";
      const url = new URL(`/demo/${path}/`, config.publicAppUrl); url.hash = `pair=${code}`;
      return { code, codeExpiresAt, role, url: url.toString(), qr: await QRCode.toDataURL(url.toString(), { width: 220, margin: 2 }) };
    },
    async pair(code, now = new Date()) {
      gate(config); const token = randomBytes(32).toString("base64url");
      const candidate = await models.DemoClient.findOne({ codeHash: hash(code), codeExpiresAt: { $gt: now }, expiresAt: { $gt: now } }).lean();
      if (!candidate) fail(401, "PAIR_INVALID", "Pairing code expired or was already used");
      await getSession(candidate.sessionId, now);
      const row = await models.DemoClient.findOneAndUpdate({ _id: candidate._id, codeHash: hash(code), codeExpiresAt: { $gt: now } }, { $set: { tokenHash: hash(token), pairedAt: now, lastSeenAt: now }, $unset: { codeHash: "", offlineAt: "" } }, { returnDocument: "after" }).lean();
      if (!row) fail(401, "PAIR_INVALID", "Pairing code expired or was already used");
      return { token, role: row.role, sessionId: row.sessionId, roomId: row.roomId, expiresAt: row.expiresAt };
    },
    async state(grant, now = new Date()) {
      const session = await getSession(grant.sessionId, now), room = found(await models.Room.findById(session.roomId).lean());
      const context = await roomContext(models, room, config, now);
      const visibleSession = safeDemoSession(session);
      if (grant.role === "camera") { delete visibleSession.markerDataUrl; delete visibleSession.scene; }
      return { session: visibleSession, room: { _id: room._id, code: room.code, name: room.name, policyVersion: room.policyVersion },
        master: { reportedSupply: context.breaker?.reportedSupply, automationDisabled: context.breaker?.automationDisabled, health: context.breaker?.health },
        effectiveEquipment: effectiveEquipment(session.scene, context.breaker?.reportedSupply), observed: context.observed, protectedBy: context.protectedBy,
        serverTime: now, role: grant.role };
    },
    async scene(grant, input, now = new Date()) {
      if (!["classroom", "presenter"].includes(grant.role)) fail(403, "DEMO_ROLE", "Camera role cannot select classroom scenarios");
      return withRoomLock(models, grant.roomId, async () => {
        const session = await getSession(grant.sessionId, now);
        if (session.scene.locked && (input.name !== session.scene.name || (input.localSwitches && JSON.stringify(input.localSwitches) !== JSON.stringify(session.scene.localSwitches)))) fail(409, "PRESENTER_LOCKED", "Unlock the presenter before changing scenes or local switches");
        const localSwitches = input.localSwitches ?? Object.fromEntries(["light", "fan", "ac", "display"].map(key => [key, input.name === "empty_off" ? false : ["occupied", "empty_on"].includes(input.name) || input.name === key]));
        const scene = { name: input.name, locked: input.locked ?? session.scene.locked, localSwitches };
        await models.DemoSession.updateOne({ _id: session._id, active: true }, { $set: { scene } });
        await signedMarker(models, config, { ...session, scene });
        return scene;
      }, now);
    },
    async frame(grant, input, now = new Date()) {
      if (grant.role !== "camera") fail(403, "DEMO_ROLE", "Only the camera role may upload frames");
      const session = await getSession(grant.sessionId, now);
      if (session.visionMode === "scenario_injection") fail(409, "INJECTION_MODE", "Scenario injection is separate from camera inference; change session mode to process pixels");
      const capturedAt = new Date(input.capturedAt);
      if (Math.abs(now - capturedAt) > 5000) fail(400, "STALE_FRAME", "Discard old frames; synchronise the phone clock and capture a new frame");
      if (Buffer.from(input.image, "base64").length > 250000) fail(413, "FRAME_TOO_LARGE", "Resize frames to at most 250KB");
      const owner = randomUUID();
      const locked = await models.DemoSession.findOneAndUpdate({ _id: session._id, active: true, $or: [{ frameBusyUntil: { $exists: false } }, { frameBusyUntil: { $lte: now } }] }, { $set: { frameOwner: owner, frameBusyUntil: new Date(+now + 10000) } }, { returnDocument: "after" }).lean();
      if (!locked) fail(429, "FRAME_BUSY", "Previous frame still processing; discard this frame");
      try {
        const accepted = await models.DemoClient.updateOne({ _id: grant._id, generation: grant.generation, pairedAt: grant.pairedAt, lastSequence: { $lt: input.sequence } }, { $set: { lastSequence: input.sequence, lastSeenAt: now, captureActive: true } });
        if (!accepted.matchedCount) fail(409, "FRAME_SEQUENCE", "Frame sequence is duplicate or out of order");
        const result = await vision.process({ image: input.image, mime: input.mime, mode: session.visionMode });
        const processedAt = new Date();
        // Processing latency cannot promote obsolete captures to current evidence.
        if (processedAt - capturedAt > 4000) fail(409, "STALE_FRAME", "Frame became stale during inference; capture a new one");
        if (!(await models.DemoClient.exists({ _id: grant._id, generation: grant.generation, pairedAt: grant.pairedAt, captureActive: true }))) fail(409, "CAMERA_STOPPED", "Camera stopped or was re-paired while this frame was processed");
        const marker = session.visionMode === "instrumented" && result.usable ? decodeMarker(config, session, result.marker) : null;
        const data = { ...result, occupancy: marker?.occupancy ?? result.occupancy, equipment: marker?.equipment ?? {},
          source: session.visionMode === "instrumented" ? "instrumented_demo_vision" : "camera_inference",
          reason: session.visionMode === "instrumented" ? marker ? "Session marker decoded from submitted pixels; demonstration convention" : "Unreadable, foreign or invalid scene marker; occupancy unknown" : result.reason };
        let observation;
        // A brief policy lock is contention, not a failed detector. Retry only
        // within this one frame's bounded freshness window; never queue forever.
        for (let attempt = 0; attempt < 4; attempt++) {
          try { observation = await observe(session, data, capturedAt, input.sequence, new Date(), grant); break; }
          catch (error) {
            if (error.code !== "ROOM_BUSY" || attempt === 3) throw error;
            await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
            if (Date.now() - capturedAt > 4000) fail(409, "STALE_FRAME", "Frame became stale waiting for the room policy lock");
          }
        }
        await models.DemoSession.updateOne({ _id: session._id, active: true, frameOwner: owner }, { $set: { lastFrameAt: processedAt, lastFrameSequence: input.sequence,
          ...(result.thumbnail ? { thumbnail: Buffer.from(result.thumbnail, "base64"), thumbnailType: "image/jpeg", thumbnailExpiresAt: new Date(+processedAt + 120000) } : {}) }, $inc: { processedFrames: 1 } });
        return { accepted: true, sequence: input.sequence, capturedAt, processedAt, observation, processingMs: result.processingMs, physicalEvidence: false };
      } catch (error) {
        if (!["FRAME_SEQUENCE", "FRAME_BUSY", "ROOM_BUSY"].includes(error.code)) {
          await models.Integration.updateOne({ _id: session.sourceId }, { $set: { health: "offline" } });
          await withRoomLock(models, session.roomId, () => cancelRoomWork(models, session.roomId, "Camera frame failed; occupancy unknown"));
        }
        throw error;
      } finally { await models.DemoSession.updateOne({ _id: session._id, frameOwner: owner }, { $unset: { frameOwner: "", frameBusyUntil: "" } }); }
    },
    async inject(grant, input, now = new Date()) {
      if (!["presenter", "classroom"].includes(grant.role)) fail(403, "DEMO_ROLE", "Presenter role required for scenario injection");
      const session = await getSession(grant.sessionId, now);
      if (session.visionMode !== "scenario_injection") fail(409, "VISION_MODE", "Injection only works in explicitly labelled scenario-injection sessions");
      const observation = await observe(session, { ...input, equipment: { light: input.equipmentOn }, usable: true, source: "scenario_injection", modelVersion: "explicit-scenario-injection-v1", reason: "Explicit scenario injection; no pixels processed" }, now, `injection-${randomUUID()}`, now);
      return { observation, pixelsProcessed: false };
    },
    async offline(grant, now = new Date()) {
      await models.DemoClient.updateOne({ _id: grant._id }, { $set: { offlineAt: now, captureActive: false } });
      if (grant.role === "camera") await withRoomLock(models, grant.roomId, async () => {
        await models.Integration.updateOne({ _id: grant.session.sourceId }, { $set: { health: "offline" } });
        await cancelRoomWork(models, grant.roomId, "Phone camera stopped or backgrounded; occupancy unknown", now);
      }, now);
    },
    commands: grant => classroomCommands(models, config, grant),
    async ack(grant, input) {
      const command = await acknowledgeClassroom(models, config, grant, input);
      const session = await getSession(grant.sessionId); await signedMarker(models, config, session);
      return command;
    },
    async manualSupply(grant, input) {
      if (!["classroom", "presenter"].includes(grant.role) || !grant.session.allowManualControl) fail(403, "MANUAL_DISABLED", "Administrator has not authorised manual simulated supply control for this session");
      return createRoomMaster(models, config).setSupply(grant.roomId, { ...input, reason: "staff_override" }, `demo-presenter:${grant._id}`);
    },
    async details(id, now = new Date()) {
      const session = found(await models.DemoSession.findById(id).lean()), room = found(await models.Room.findById(session.roomId).lean());
      const [context, clients, commands, incidents] = await Promise.all([
        roomContext(models, room, config, now), models.DemoClient.find({ sessionId: id }).lean(),
        models.Command.find({ demoSessionId: id }).sort({ issuedAt: -1 }).limit(30).lean(),
        models.Incident.find({ demoSessionId: id }).sort({ openedAt: -1 }).limit(10).lean(),
      ]);
      const jobs = await models.Job.find({ incidentId: { $in: incidents.map(item => item._id) } }).sort({ dueAt: 1 }).lean();
      return { session: safeDemoSession(session), room: { _id: room._id, name: room.name, code: room.code }, clients: clients.map(item => ({ role: item.role, pairedAt: item.pairedAt, lastSeenAt: item.lastSeenAt, online: demoEndpointOnline(item, now) })),
        observed: context.observed, protectedBy: context.protectedBy, protections: { booking: !!context.schedules.find(item => item.status === "confirmed"), qr: context.leases.length > 0, override: context.overrides.length > 0 },
        master: context.breaker, commands, incidents, jobs, serverTime: now };
    },
    stop: (id, actorId, now) => stopPhoneDemo(models, config, id, actorId, now),
    async close() { await vision.close(); },
  };
}
