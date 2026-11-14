import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import QRCode from "qrcode";
import { randomBytes, randomUUID, randomInt } from "node:crypto";
import { startDatabase } from "../scripts/database.mjs";
import { connectDatabase } from "../backend/src/models/index.js";
import { loadConfig } from "../backend/src/config.js";
import { createApplication } from "../backend/src/app.js";
import { seed } from "../backend/src/seed.js";
import { createPhoneDemoService, demoGrant } from "../backend/src/services/phone-demo.js";
import { demoSessionInput } from "../shared/phone-demo-contracts.js";
import { roomContext } from "../backend/src/services/context.js";
import { createRoomMaster } from "../backend/src/adapters/room-master.js";
import { acknowledgeClassroom, classroomCommands, reconcileClassroomCommands } from "../backend/src/adapters/demo-classroom.js";
import { tick } from "../backend/src/workers/tick.js";
import { effectiveEquipment } from "../backend/src/services/demo-session-state.js";

let db, connection, models, config, runtime, service, admin, csrf;
const origin = "http://localhost:5000", password = randomBytes(18).toString("hex");
const mutate = (path, body = {}, agent = admin, token = csrf) => agent.post(`/api/v1${path}`).set("Origin", origin).set("X-CSRF-Token", token).send(body);
const phone = (path, token, body, method = "post") => request(runtime.app)[method](`/api/v1/demo-phone${path}`).set("Origin", origin).set("Authorization", `Bearer ${token}`).send(body);
async function auth(email) {
  const agent = request.agent(runtime.app), initial = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
  const login = await mutate("/auth/login", { email, password }, agent, initial);
  assert.equal(login.status, 200); return { agent, token: login.body.data.csrfToken };
}
before(async () => {
  db = await startDatabase(); ({ connection, models } = await connectDatabase(db.getUri("phone_demo_test")));
  config = loadConfig({ NODE_ENV: "test", SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"),  PUBLIC_APP_URL: origin, DEMO_MODE: "true" });
  await seed(models, config, { password }); runtime = createApplication({ models, connection, config }); service = createPhoneDemoService(models, config);
  ({ agent: admin, token: csrf } = await auth("admin@campus.test"));
});
beforeEach(async () => {
  for (const session of await models.DemoSession.find({ active: true }).lean()) await service.stop(session._id, "test");
  for (const model of [models.DemoSession, models.DemoClient, models.Observation, models.Command, models.Job, models.Incident, models.Schedule, models.AccessLease, models.Override]) await model.deleteMany({});
  await models.Integration.deleteMany({ _id: /^phone-camera-/ });
  await models.Room.updateMany({}, { $set: { nativeOffMode: "alert_only", controlMode: "alert_only", cameraConfiguration: "installed", coverageValidated: true, independentInfrastructure: true, policyVersion: 1 }, $unset: { demoSessionId: "", demoScenario: "", demoUntil: "" } });
  await models.Room.updateOne({ _id: "room-r101" }, { $set: { requiredSourceIds: ["CAM-R101"] } });
  await models.Breaker.updateMany({}, { $set: { reportedSupply: "on", health: "online", faultTripped: false, maintenanceLocked: false, manuallyIsolated: false, interlocksKnown: true, automationDisabled: false }, $unset: { lastChangedAt: "", lastRequestId: "" } });
  await models.Device.updateMany({}, { $set: { nativeOffRequired: false, essential: false, supplyInterruptionApproved: true, requiresNormalStopBeforeCutoff: false, restartDelaySeconds: 0 } });
});
after(async () => { await service?.close(); await runtime?.close(); await connection?.close(); await db?.stop(); });

async function setup(extra = {}) {
  const session = await service.create(demoSessionInput.parse({ roomId: "room-r101", coverageReviewed: true, vacancyConfirmationSeconds: 2, allowManualControl: true, ...extra }), "demo-admin");
  const camera = await service.pair((await service.issuePairing(session._id, "camera", "demo-admin")).code);
  const classroom = await service.pair((await service.issuePairing(session._id, "classroom", "demo-admin")).code);
  return { session, camera, classroom, cameraGrant: await demoGrant(models, config, camera.token), classroomGrant: await demoGrant(models, config, classroom.token) };
}
async function frame(fixture, sequence = 1, image = fixture.session.markerDataUrl) {
  return service.frame(fixture.cameraGrant, { sequence, capturedAt: new Date().toISOString(), mime: "image/png", image: image.split(",")[1] });
}
// Synthetic temporal replay is used only to exercise durable jobs quickly. The
// separate pixel tests and browser runner actually submit QR/camera pixels.
async function temporal(session, now = new Date(), occupancy = "vacant") {
  await models.Observation.deleteMany({ sourceId: session.sourceId });
  for (let offset = -6000; offset <= 0; offset += 1000) await models.Observation.create({ eventId: randomUUID(), roomId: session.roomId, sourceId: session.sourceId, capturedAt: new Date(+now + offset), receivedAt: now, occupancy, confidence: 1, coverageValidated: true, quality: { usable: true, reason: "Isolated temporal replay fixture, not camera inference" }, dataMode: "simulated", modelVersion: "test-temporal-fixture" });
  await models.Integration.updateOne({ _id: session.sourceId }, { $set: { health: "online", lastSeenAt: now } });
  await models.DemoSession.updateOne({ _id: session._id }, { $set: { latestObservation: { equipment: { light: true }, occupancy } } });
}
async function finalCommand(fixture) {
  const opened = new Date(); await temporal(fixture.session, opened); await tick(models, config, opened, "first-worker");
  const second = new Date(+opened + 10000); await temporal(fixture.session, second); await tick(models, config, second, "restarted-worker");
  const final = new Date(+opened + 25000); await temporal(fixture.session, final); await tick(models, config, final, "restarted-worker");
  await models.DemoClient.updateOne({ _id: fixture.classroomGrant._id }, { $set: { lastSeenAt: final } });
  return { command: await models.Command.findOne({ demoSessionId: fixture.session._id }).lean(), final };
}

test("admin-only session setup preserves inventory/native policies and validates room ownership", async () => {
  assert.equal((await request(runtime.app).post("/api/v1/demo/sessions").set("Origin", origin).send({})).status, 403);
  const teacher = await auth("teacher@campus.test");
  assert.equal((await mutate("/demo/sessions", { roomId: "room-r101", coverageReviewed: true }, teacher.agent, teacher.token)).status, 403);
  await models.Room.updateOne({ _id: "room-r101" }, { $set: { nativeOffMode: "live" } });
  assert.equal((await mutate("/demo/sessions", { roomId: "room-r101", coverageReviewed: true })).status, 409);
  await models.Room.updateOne({ _id: "room-r101" }, { $set: { nativeOffMode: "alert_only" } });
  const created = await mutate("/demo/sessions", { roomId: "room-r101", coverageReviewed: true }); assert.equal(created.status, 201);
  assert.equal((await mutate("/demo/sessions", { roomId: "room-r101", coverageReviewed: true })).status, 409);
  assert.equal((await models.Device.findOne({ roomId: "room-r101" }).lean()).supplyInterruptionApproved, true);
  assert.equal((await models.Room.findById("room-r101").lean()).nativeOffMode, "alert_only");
});

test("pairing is one-use, expiring, scoped and revocable without administrator credentials", async () => {
  const { session, camera, classroom } = await setup();
  assert.equal((await phone("/state", camera.token, undefined, "get")).status, 200);
  assert.equal((await phone("/scene", camera.token, { name: "occupied" })).status, 403);
  assert.equal((await phone("/frames", classroom.token, { sequence: 1, capturedAt: new Date().toISOString(), mime: "image/png", image: session.markerDataUrl.split(",")[1] })).status, 403);
  const code = await service.issuePairing(session._id, "presenter", "demo-admin");
  await service.pair(code.code); await assert.rejects(() => service.pair(code.code), { code: "PAIR_INVALID" });
  const expired = await service.issuePairing(session._id, "presenter", "demo-admin");
  await assert.rejects(() => service.pair(expired.code, new Date(+new Date(expired.codeExpiresAt) + 1)), { code: "PAIR_INVALID" });
  await frame({ session, cameraGrant: await demoGrant(models, config, camera.token) }, 1);
  const replacement = await service.pair((await service.issuePairing(session._id, "camera", "demo-admin")).code);
  await assert.rejects(() => demoGrant(models, config, camera.token), { code: "PAIR_EXPIRED" });
  // A replacement phone may start sequence numbering at one without colliding
  // with observations from the old pairing generation.
  assert.equal((await frame({ session, cameraGrant: await demoGrant(models, config, replacement.token) }, 1)).accepted, true);
  await service.stop(session._id, "demo-admin"); await assert.rejects(() => demoGrant(models, config, classroom.token), { code: "PAIR_EXPIRED" });
  const room = await models.Room.findById(session.roomId).lean(); assert.equal(room.controlMode, "alert_only"); assert.deepEqual(room.requiredSourceIds, ["CAM-R101"]);
});

test("legacy rooms without native policy remain selectable; unavailable rooms have server-checked reasons", async () => {
  await models.Room.updateOne({ _id: "room-r101" }, { $unset: { nativeOffMode: "" } });
  const available = await admin.get("/api/v1/demo/available-rooms");
  assert.equal(available.status, 200);
  assert.equal(available.body.data.find(room => room._id === "room-r101").unavailableReason, null);
  const fixture = await setup();
  assert.match((await service.availableRooms()).find(room => room._id === "room-r101").unavailableReason, /already owns/);
  await service.stop(fixture.session._id, "test");
  await models.Breaker.updateOne({ _id: "BRK-R101" }, { $set: { maintenanceLocked: true } });
  assert.match((await service.availableRooms()).find(room => room._id === "room-r101").unavailableReason, /locked/);
  await assert.rejects(() => setup(), { code: "DEMO_ROOM_BUSY" });
});

test("a newly registered room becomes available only after independent supplies and load inventory are reviewed", async () => {
  const created = await mutate("/rooms", { code: "NEW-DEMO", name: "Fresh simulated demo room", roomBreakerId: "MASTER-NEW-DEMO" });
  assert.equal(created.status, 201); const room = created.body.data;
  const candidate = async () => {
    const response = await admin.get("/api/v1/demo/available-rooms"); assert.equal(response.status, 200);
    return response.body.data.find(row => row._id === room._id);
  };
  const patch = async (path, body) => {
    const response = await admin.patch(`/api/v1${path}`).set("Origin", origin).set("X-CSRF-Token", csrf).send(body);
    assert.equal(response.status, 200, JSON.stringify(response.body.error));
  };
  let session;
  try {
    assert.equal((await models.Breaker.findById(room.roomBreakerId).lean()).health, "online");
    assert.match((await candidate()).unavailableReason, /Independent camera\/network\/control supplies/);
    const blocked = await mutate("/demo/sessions", { roomId: room._id, visionMode: "scenario_injection", coverageReviewed: true });
    assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, "DEMO_ROOM_BUSY");
    await patch(`/rooms/${room._id}`, { independentInfrastructure: true });
    assert.match((await candidate()).unavailableReason, /load inventory/);
    const registered = await mutate("/devices", { roomId: room._id, name: "Virtual demonstration light", category: "lighting", ratedWatts: 20 });
    assert.equal(registered.status, 201);
    assert.match((await candidate()).unavailableReason, /not been approved/);
    await patch(`/devices/${registered.body.data._id}`, { supplyInterruptionApproved: true, restartBehaviourKnown: true, approvalNotes: "Isolated simulated light only; no physical installation approval" });
    assert.equal((await candidate()).unavailableReason, null);
    const started = await mutate("/demo/sessions", { roomId: room._id, visionMode: "scenario_injection", coverageReviewed: true });
    assert.equal(started.status, 201); session = started.body.data;
    assert.equal((await models.Room.findById(room._id).lean()).controlMode, "simulated");
  } finally {
    if (session) await service.stop(session._id, "test-cleanup");
    await models.Device.deleteMany({ roomId: room._id }); await models.Breaker.deleteOne({ _id: room.roomBreakerId }); await models.Room.deleteOne({ _id: room._id });
  }
});

test("actual submitted QR pixels produce instrumented occupancy and equipment, not the selected scenario", async () => {
  const fixture = await setup();
  const result = await frame(fixture); assert.equal(result.observation.occupancy, "vacant");
  assert.equal(result.observation.evidenceSource, "instrumented_demo_vision"); assert.equal(result.observation.dataMode, "simulated"); assert.equal(result.observation.equipment.fan, true);
  await service.scene(fixture.classroomGrant, { name: "occupied" });
  // Old still-visible QR genuinely decodes vacant even though presenter selected
  // occupied. No server-side scene-to-inference shortcut is allowed.
  assert.equal((await frame(fixture, 2)).observation.occupancy, "vacant");
  const current = await models.DemoSession.findById(fixture.session._id).lean();
  assert.equal((await frame(fixture, 3, current.markerDataUrl)).observation.occupancy, "occupied");
  const body = JSON.stringify((await admin.get(`/api/v1/demo/sessions/${fixture.session._id}`)).body);
  assert.ok(!body.includes(fixture.camera.token)); assert.ok(!body.includes("tokenHash")); assert.ok(!body.includes("codeHash"));
  assert.equal((await request(runtime.app).get(`/api/v1/demo/sessions/${fixture.session._id}/frame`)).status, 401);
  assert.equal((await admin.get(`/api/v1/demo/sessions/${fixture.session._id}/frame`)).status, 200);
});

test("configured standalone phone origins receive narrow bearer-only CORS, hostile origins remain rejected", async () => {
  const fixture = await setup();
  const preflight = await request(runtime.app).options("/api/v1/demo-phone/frames").set("Origin", "http://localhost:5174").set("Access-Control-Request-Headers", "authorization,content-type");
  assert.equal(preflight.status, 204); assert.equal(preflight.headers["access-control-allow-origin"], "http://localhost:5174");
  const state = await request(runtime.app).get("/api/v1/demo-phone/state").set("Origin", "http://localhost:5174").set("Authorization", `Bearer ${fixture.camera.token}`);
  assert.equal(state.status, 200); assert.equal(state.headers["access-control-allow-origin"], "http://localhost:5174");
  assert.equal(state.headers["access-control-allow-credentials"], undefined);
  const hostile = await request(runtime.app).get("/api/v1/demo-phone/state").set("Origin", "https://untrusted.test").set("Authorization", `Bearer ${fixture.camera.token}`);
  assert.equal(hostile.status, 403); assert.equal(hostile.headers["access-control-allow-origin"], undefined);
});

test("room/session isolation excludes foreign markers and commands even with valid other-room pairing", async () => {
  const fixture = await setup();
  const other = await service.create(demoSessionInput.parse({ roomId: "room-r103", coverageReviewed: true, allowManualControl: true }), "demo-admin");
  const otherPhone = await service.pair((await service.issuePairing(other._id, "classroom", "demo-admin")).code);
  const otherGrant = await demoGrant(models, config, otherPhone.token);
  const command = await service.manualSupply(otherGrant, { requestId: randomUUID(), action: "off" });
  assert.equal((await frame(fixture, 1, other.markerDataUrl)).observation.occupancy, "unknown");
  assert.deepEqual(await service.commands(fixture.cameraGrant), []);
  assert.deepEqual(await service.commands(fixture.classroomGrant), []);
  await assert.rejects(() => service.ack(fixture.classroomGrant, { commandId: command._id, action: "off", applied: true }), { code: "COMMAND_SCOPE" });
  const response = await phone("/frames", fixture.camera.token, { sequence: 2, capturedAt: new Date().toISOString(), mime: "image/png", image: fixture.session.markerDataUrl.split(",")[1], roomId: "room-r103" });
  assert.equal(response.status, 400); assert.equal(await models.Observation.countDocuments({ sourceId: other.sourceId }), 0);
});

test("brief policy lock contention does not mark a valid camera offline or enqueue unlimited frames", async () => {
  const fixture = await setup(); await frame(fixture);
  await models.Room.updateOne({ _id: "room-r101" }, { $set: { commandLockOwner: "test-contention", commandLockUntil: new Date(Date.now() + 5000) } });
  try { await assert.rejects(() => frame(fixture, 2), { code: "ROOM_BUSY" }); }
  finally { await models.Room.updateOne({ _id: "room-r101", commandLockOwner: "test-contention" }, { $unset: { commandLockOwner: "", commandLockUntil: "" } }); }
  assert.equal((await models.Integration.findById(fixture.session.sourceId).lean()).health, "online");
  assert.equal((await models.DemoSession.findById(fixture.session._id).lean()).processedFrames, 1);
  assert.equal((await frame(fixture, 3)).observation.occupancy, "vacant");
});

test("foreign/unreadable markers and HOG no-detection yield unknown, with injection kept separate", async () => {
  const fixture = await setup();
  const foreign = await QRCode.toDataURL("CE1|foreign-session|1|0|15|invalid-signature", { width: 360 });
  assert.equal((await frame(fixture, 1, foreign)).observation.occupancy, "unknown");
  await assert.rejects(() => service.inject(fixture.classroomGrant, { occupancy: "vacant", equipmentOn: true }), { code: "VISION_MODE" });
  await service.stop(fixture.session._id, "test");
  const inference = await setup({ visionMode: "camera_inference" });
  const result = await frame(inference); assert.equal(result.observation.occupancy, "unknown"); assert.deepEqual(result.observation.equipment, {});
  assert.equal(result.observation.evidenceSource, "camera_inference");
  await service.stop(inference.session._id, "test");
  const injection = await setup({ visionMode: "scenario_injection" });
  assert.equal((await service.inject(injection.classroomGrant, { occupancy: "vacant", equipmentOn: true })).observation.evidenceSource, "scenario_injection");
  await assert.rejects(() => frame(injection), { code: "INJECTION_MODE" });
});

test("frame MIME/size/timestamp/sequence and per-session processing bounds are enforced", async () => {
  const fixture = await setup(); await frame(fixture);
  await assert.rejects(() => frame(fixture), { code: "FRAME_SEQUENCE" });
  const payload = { sequence: 2, capturedAt: new Date(Date.now() - 10000).toISOString(), mime: "image/png", image: fixture.session.markerDataUrl.split(",")[1] };
  await assert.rejects(() => service.frame(fixture.cameraGrant, payload), { code: "STALE_FRAME" });
  await assert.rejects(() => service.frame(fixture.cameraGrant, { ...payload, capturedAt: new Date().toISOString(), image: Buffer.alloc(250001).toString("base64") }), { code: "FRAME_TOO_LARGE" });
  await models.DemoSession.updateOne({ _id: fixture.session._id }, { $set: { frameBusyUntil: new Date(Date.now() + 5000) } });
  await assert.rejects(() => frame(fixture, 2), { code: "FRAME_BUSY" });
  await models.DemoSession.updateOne({ _id: fixture.session._id }, { $unset: { frameBusyUntil: "" } });
  await assert.rejects(() => service.frame(fixture.cameraGrant, { ...payload, capturedAt: new Date().toISOString(), mime: "image/jpeg" }), { code: "INVALID_FRAME" });
  const room = await models.Room.findById(fixture.session.roomId).lean(); assert.equal((await roomContext(models, room, config)).observed.state, "unknown");
});

test("existing persistent stages survive worker replacement; supply waits for classroom application acknowledgement", async () => {
  const fixture = await setup(), { command, final } = await finalCommand(fixture);
  assert.ok(command); assert.equal(command.state, "pending"); assert.equal(command.result, undefined);
  assert.equal((await models.Breaker.findById("BRK-R101").lean()).reportedSupply, "on");
  const incident = await models.Incident.findById(command.incidentId).lean();
  assert.deepEqual(incident.timeline.slice(0, 3).map(item => item.event), ["opened", "first_notification", "second_notification"]);
  assert.equal(incident.timing.firstEscalationMs, 10000); assert.equal(incident.timing.finalAdditionalMs, 15000);
  const delivered = await classroomCommands(models, config, fixture.classroomGrant, final); assert.equal(delivered.length, 1);
  const ack = await acknowledgeClassroom(models, config, fixture.classroomGrant, { commandId: command._id, action: "off", applied: true }, final);
  assert.equal(ack.result.verification, "simulator_acknowledged"); assert.equal(ack.result.physicalVerification, false);
  assert.equal((await models.Breaker.findById("BRK-R101").lean()).reportedSupply, "off");
  assert.ok(Object.values(effectiveEquipment(fixture.session.scene, "off")).every(value => value === false));
  assert.equal((await models.Incident.findById(command.incidentId).lean()).state, "resolved");
  assert.equal((await acknowledgeClassroom(models, config, fixture.classroomGrant, { commandId: command._id, action: "off", applied: true }, final))._id, command._id);
});

test("occupied, camera loss, booking, QR and override protect/cancel existing pending shutdown", async () => {
  for (const protection of ["occupied", "camera_loss", "booking", "qr", "override"]) {
    const fixture = await setup(); await temporal(fixture.session); await tick(models, config);
    const incident = await models.Incident.findOne({ demoSessionId: fixture.session._id, active: true }).lean(); assert.ok(incident, protection);
    const now = new Date();
    if (protection === "occupied") await temporal(fixture.session, now, "occupied");
    if (protection === "camera_loss") await service.offline(fixture.cameraGrant);
    if (protection === "booking") await models.Schedule.create({ roomId: fixture.session.roomId, title: "Protected lesson", startAt: new Date(+now - 1000), endAt: new Date(+now + 60000), status: "confirmed" });
    if (protection === "qr") await models.AccessLease.create({ roomId: fixture.session.roomId, startAt: new Date(+now - 1000), expiresAt: new Date(+now + 60000), endedAt: null });
    if (protection === "override") await models.Override.create({ roomId: fixture.session.roomId, startAt: new Date(+now - 1000), expiresAt: new Date(+now + 60000), endedAt: null });
    await tick(models, config);
    assert.equal((await models.Incident.findById(incident._id).lean()).state, "cancelled", protection);
    assert.equal(await models.Command.countDocuments({ demoSessionId: fixture.session._id }), 0);
    await service.stop(fixture.session._id, "test");
    for (const model of [models.Schedule, models.AccessLease, models.Override]) await model.deleteMany({ roomId: "room-r101" });
  }
});

test("API/database-client restart preserves pairing, session and escalation deadlines without reseeding", async () => {
  const fixture = await setup(), opened = new Date();
  await temporal(fixture.session, opened); await tick(models, config, opened, "before-api-restart");
  const originalJobs = await models.Job.find({ roomId: fixture.session.roomId }).sort({ dueAt: 1 }).lean();
  const uri = db.getUri("phone_demo_test");
  await service.close(); await runtime.close(); await connection.close();
  ({ connection, models } = await connectDatabase(uri));
  config = { ...config }; runtime = createApplication({ models, connection, config }); service = createPhoneDemoService(models, config);
  ({ agent: admin, token: csrf } = await auth("admin@campus.test"));
  const restored = await phone("/state", fixture.camera.token, undefined, "get"); assert.equal(restored.status, 200); assert.equal(restored.body.data.session._id, fixture.session._id);
  const storedJobs = await models.Job.find({ roomId: fixture.session.roomId }).sort({ dueAt: 1 }).lean();
  assert.deepEqual(storedJobs.map(item => [item._id, +item.dueAt]), originalJobs.map(item => [item._id, +item.dueAt]));
  const final = new Date(+opened + 25000); await temporal(fixture.session, final); await tick(models, config, final, "after-api-restart");
  assert.equal(await models.Command.countDocuments({ demoSessionId: fixture.session._id }), 1);
  const command = await models.Command.findOne({ demoSessionId: fixture.session._id }).lean(); assert.equal(command.state, "pending");
  assert.equal((await models.Breaker.findById("BRK-R101").lean()).reportedSupply, "on");
});

test("classroom disconnect/expiry remains unverified and expired commands are not delivered on reconnect", async () => {
  const fixture = await setup(), { command, final } = await finalCommand(fixture);
  await classroomCommands(models, config, fixture.classroomGrant, final);
  await service.offline(fixture.classroomGrant, final);
  const after = new Date(+command.expiresAt + 1); await reconcileClassroomCommands(models, after);
  const expired = await models.Command.findById(command._id).lean(); assert.equal(expired.state, "unverified");
  assert.equal((await models.Breaker.findById("BRK-R101").lean()).reportedSupply, "on");
  assert.deepEqual(await classroomCommands(models, config, fixture.classroomGrant, after), []);
  await assert.rejects(() => acknowledgeClassroom(models, config, fixture.classroomGrant, { commandId: command._id, action: "off", applied: true }, after), { code: "COMMAND_EXPIRED" });
  assert.equal((await models.Incident.findById(command.incidentId).lean()).state, "action_unverified");
});

test("manual supply remains permissioned, explicit/idempotent and subject to fault/restoration/critical-load interlocks", async () => {
  const fixture = await setup({ allowManualControl: false });
  await assert.rejects(() => service.manualSupply(fixture.classroomGrant, { requestId: randomUUID(), action: "off" }), { code: "MANUAL_DISABLED" });
  const master = createRoomMaster(models, config);
  await models.Breaker.updateOne({ _id: "BRK-R101" }, { $set: { maintenanceLocked: true } });
  await assert.rejects(() => master.setSupply("room-r101", { requestId: randomUUID(), action: "on", reason: "staff_override" }, "demo-admin"), { code: "CONTROL_BLOCKED" });
  await models.Breaker.updateOne({ _id: "BRK-R101" }, { $set: { maintenanceLocked: false } });
  await models.Device.updateOne({ roomId: "room-r101" }, { $set: { essential: true } });
  await assert.rejects(() => master.setSupply("room-r101", { requestId: randomUUID(), action: "off", reason: "staff_override" }, "demo-admin"), { code: "CONTROL_BLOCKED" });
  await models.Device.updateMany({ roomId: "room-r101" }, { $set: { essential: false } });
  const input = { requestId: randomUUID(), action: "off", reason: "staff_override" };
  const first = await master.setSupply("room-r101", input, "demo-admin"), second = await master.setSupply("room-r101", input, "demo-admin");
  assert.equal(first._id, second._id); assert.equal(await models.Command.countDocuments({ requestId: input.requestId }), 1);
});

test("manual ON survives vacancy cancellation but still needs classroom ACK; session stop cancels all remaining commands", async () => {
  const fixture = await setup();
  await models.Breaker.updateOne({ _id: "BRK-R101" }, { $set: { reportedSupply: "off", automationDisabled: true } });
  const command = await service.manualSupply(fixture.classroomGrant, { action: "on", requestId: randomUUID() });
  await tick(models, config);
  assert.equal((await models.Command.findById(command._id).lean()).state, "pending");
  assert.equal((await models.Breaker.findById("BRK-R101").lean()).reportedSupply, "off");
  await service.commands(fixture.classroomGrant);
  await service.ack(fixture.classroomGrant, { commandId: command._id, action: "on", applied: true });
  assert.equal((await models.Breaker.findById("BRK-R101").lean()).reportedSupply, "on");
});

test("stopping a session cancels pending commands and expiration restores only demo configuration, never energises supply", async () => {
  const fixture = await setup(), master = createRoomMaster(models, config);
  const command = await master.setSupply("room-r101", { requestId: randomUUID(), action: "off", reason: "staff_override" }, "demo-admin");
  await service.stop(fixture.session._id, "test");
  assert.equal((await models.Command.findById(command._id).lean()).state, "cancelled");
  assert.equal((await models.Breaker.findById("BRK-R101").lean()).reportedSupply, "on");
  const next = await setup(); await models.Breaker.updateOne({ _id: "BRK-R101" }, { $set: { reportedSupply: "off", maintenanceLocked: true } });
  await models.DemoSession.updateOne({ _id: next.session._id }, { $set: { expiresAt: new Date(Date.now() - 1) } });
  await tick(models, config); assert.equal((await models.DemoSession.findById(next.session._id).lean()).active, false);
  assert.equal((await models.Breaker.findById("BRK-R101").lean()).reportedSupply, "off");
});

test("demo gates reject non-demo operation and never instantiate a live provider-control path", async () => {
  const liveConfig = { ...config, demoMode: false, timeScale: 1, allowNativeControl: true };
  const disabled = createPhoneDemoService(models, liveConfig);
  try {
    await assert.rejects(() => disabled.create(demoSessionInput.parse({ roomId: "room-r101", coverageReviewed: true }), "demo-admin"), { code: "DEMO_DISABLED" });
    await assert.rejects(() => demoGrant(models, liveConfig, randomBytes(32).toString("hex")), { code: "DEMO_DISABLED" });
    assert.equal(await models.NativeCommand.countDocuments({}), 0);
  } finally { await disabled.close(); }
});
