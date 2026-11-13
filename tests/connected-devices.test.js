import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomBytes, randomUUID, randomInt } from "node:crypto";
import { startDatabase } from "../scripts/database.mjs";
import { connectDatabase } from "../backend/src/models/index.js";
import { loadConfig } from "../backend/src/config.js";
import { createApplication } from "../backend/src/app.js";
import { seed } from "../backend/src/seed.js";
import { getConnectedDeviceService } from "../backend/src/services/connected-devices.js";
import { tick, ensureIncidentJobs } from "../backend/src/workers/tick.js";
import { startHomeAssistantMock } from "./helpers/home-assistant-mock.js";
import { createRoomMaster } from "../backend/src/adapters/room-master.js";
let database, connection, models, config, runtime, service, admin, csrf;
const password = randomBytes(18).toString("hex"), origin = "http://localhost:5000";
const mutate = (path, body, method = "post", agent = admin, token = csrf) => agent[method](`/api/v1${path}`).set("Origin", origin).set("X-CSRF-Token", token).send(body);
async function auth(email) {
  const agent = request.agent(runtime.app), initial = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
  const result = await mutate("/auth/login", { email, password, ...(email.startsWith("admin") ? { adminKey: config.adminInviteKey } : {}) }, "post", agent, initial);
  assert.equal(result.status, 200); return { agent, token: result.body.data.csrfToken };
}
async function vacancy(mode = "simulated") {
  await models.Observation.deleteMany({ roomId: "room-r101" });
  const now = new Date();
  for (const offset of [-25000, -15000, -5000, 0]) await models.Observation.create({ eventId: randomUUID(), roomId: "room-r101", sourceId: "CAM-R101", capturedAt: new Date(+now + offset), receivedAt: now, sourceType: "camera", occupancy: "vacant", confidence: 1, coverageValidated: true, quality: { usable: true }, dataMode: mode, modelVersion: "isolated-test" });
}
before(async () => {
  database = await startDatabase(); ({ connection, models } = await connectDatabase(database.getUri("native_test")));
  config = loadConfig({ NODE_ENV: "test", SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), ADMIN_INVITE_KEY: randomInt(10000000, 100000000).toString(), DEMO_MODE: "true", DEMO_TIME_SCALE: "60", PUBLIC_APP_URL: origin });
  await seed(models, config, { password }); runtime = createApplication({ config, connection, models }); service = getConnectedDeviceService(models, config);
  const login = await auth("admin@campus.test"); admin = login.agent; csrf = login.token;
});
beforeEach(async () => {
  for (const model of [models.DeviceConnection, models.ConnectedDevice, models.NativeCommand, models.SimulatedEntity]) await model.deleteMany({});
  await models.Incident.deleteMany({ type: "vacancy" }); await models.Job.deleteMany({}); await models.Command.deleteMany({});
  await models.Schedule.deleteMany({ roomId: "room-r101" }); await models.Override.deleteMany({ roomId: "room-r101" }); await models.AccessLease.deleteMany({ roomId: "room-r101" });
  await models.Room.updateOne({ _id: "room-r101" }, { $set: { nativeOffMode: "simulated", controlMode: "simulated", cameraConfiguration: "installed", coverageValidated: true, independentInfrastructure: true, requiredSourceIds: ["CAM-R101"], policyVersion: 1 } });
  await models.Integration.updateOne({ _id: "CAM-R101" }, { $set: { health: "online", coverageValidated: true } });
  await models.Breaker.updateOne({ _id: "BRK-R101" }, { $set: { reportedSupply: "on", health: "online", faultTripped: false, maintenanceLocked: false, manuallyIsolated: false, interlocksKnown: true, nativeDeviceId: "BRK-R101" } });
  await models.Device.updateMany({ roomId: "room-r101" }, { $set: { nativeOffRequired: false } });
  await vacancy();
});
after(async () => { if (runtime) await runtime.close(); if (connection) await connection.close(); if (database) await database.stop(); });
async function setup(entityId = "light.demo_lecture") {
  const created = await mutate("/device-connections", { name: "Isolated simulator", provider: "simulator" }); assert.equal(created.status, 201, JSON.stringify(created.body));
  const conn = created.body.data; assert.equal((await mutate(`/device-connections/${conn._id}/test`, {})).status, 200);
  const registered = await mutate("/connected-devices", { connectionId: conn._id, entityId, roomId: "room-r101" }); assert.equal(registered.status, 201, JSON.stringify(registered.body));
  return { conn, target: registered.body.data };
}
const review = (id) => mutate(`/connected-devices/${id}/review`, { classification: "ordinary", identityReviewed: true, capabilityReviewed: true, manualOffAllowed: true, reviewNotes: "Exact ordinary load and native OFF reviewed for isolated simulation" }, "patch");
async function off(id, requestId = randomUUID()) {
  const result = await mutate(`/connected-devices/${id}/off`, { requestId, action: "off", confirmed: true }); assert.equal(result.status, 202, JSON.stringify(result.body));
  await service.processJobs(); return models.NativeCommand.findById(result.body.data._id).lean();
}
async function autoSetup(entityId = "light.demo_lecture") {
  const result = await setup(entityId); assert.equal((await review(result.target._id)).status, 200);
  if (entityId.includes("unconfirmed")) await service.simulateState(result.conn._id, entityId, { outcome: "confirm" });
  assert.equal((await off(result.target._id)).status, "confirmed");
  assert.equal((await mutate(`/connected-devices/${result.target._id}/automation`, { enabled: true })).status, 200);
  await service.simulateState(result.conn._id, entityId, { state: "on", ...(entityId.includes("unconfirmed") ? { outcome: "unverified" } : {}) });
  return result;
}
async function finalIncident() {
  const room = await models.Room.findById("room-r101").lean();
  const incident = await models.Incident.create({ issueKey: "vacancy:room-r101", roomId: room._id, type: "vacancy", active: true, state: "open", title: "Native OFF test", openedAt: new Date(Date.now() - 25000), policyVersion: room.policyVersion });
  await ensureIncidentJobs(models, incident.toObject(), config); return incident;
}

test("connection setup/discovery is admin-only, targets are room-scoped and input cannot supply arbitrary services", async () => {
  const { conn, target } = await setup();
  const teacher = await auth("teacher@campus.test");
  assert.equal((await mutate("/device-connections", { name: "Forbidden", provider: "simulator" }, "post", teacher.agent, teacher.token)).status, 403);
  assert.equal((await teacher.agent.get(`/api/v1/device-connections/${conn._id}/entities`)).status, 403);
  const viewer = await auth("viewer@campus.test"); await models.User.updateOne({ _id: "demo-viewer" }, { $set: { permittedRoomIds: ["room-r102"] } });
  assert.equal((await viewer.agent.get(`/api/v1/connected-devices/${target._id}`)).status, 403);
  assert.equal((await viewer.agent.get(`/api/v1/connected-devices/${target._id}/commands`)).status, 403);
  assert.equal((await mutate(`/connected-devices/${target._id}/off`, { requestId: randomUUID(), action: "off", confirmed: true, entityId: "switch.room_master", service: "toggle" })).status, 400);
});
test("simulation discovery marks unsupported groups/sensors/masters; duplicates and unreviewed controls fail", async () => {
  const { conn, target } = await setup(); const discovered = await admin.get(`/api/v1/device-connections/${conn._id}/entities`);
  assert.equal(discovered.status, 200); assert.ok(discovered.body.data.every((d) => d.mode === "simulated"));
  for (const id of ["sensor.demo_power", "switch.room_master", "light.demo_group"]) assert.equal(discovered.body.data.find((d) => d.entityId === id).capabilities.canOff, false);
  assert.equal((await mutate("/connected-devices", { connectionId: conn._id, entityId: target.entityId, roomId: "room-r102" })).status, 409);
  assert.equal((await mutate(`/connected-devices/${target._id}/off`, { requestId: randomUUID(), action: "off", confirmed: true })).status, 409);
  assert.equal((await mutate(`/connected-devices/${target._id}/automation`, { enabled: true })).status, 409);
});
test("manual native OFF persists confirmation, preserves lifecycle and suppresses duplicate requests", async () => {
  const { target } = await setup(); assert.equal((await review(target._id)).status, 200);
  const requestId = randomUUID(), command = await off(target._id, requestId);
  assert.equal(command.status, "confirmed"); assert.equal(command.verification, "simulated");
  assert.ok(command.timeline.some((item) => item.status === "dispatched"));
  assert.equal((await off(target._id, requestId))._id, command._id);
  assert.equal(await models.NativeCommand.countDocuments({ requestId }), 1);
  assert.equal((await off(target._id)).status, "already_off");
  assert.equal(await models.Command.countDocuments(), 0);
});
test("the regular worker processes manual native jobs even before automatic permission is enabled", async () => {
  const { target } = await setup(); await review(target._id);
  const queued = await mutate(`/connected-devices/${target._id}/off`, { requestId: randomUUID(), action: "off", confirmed: true });
  assert.equal(queued.status, 202); await tick(models, config);
  assert.equal((await models.NativeCommand.findById(queued.body.data._id).lean()).status, "confirmed");
});
test("the exact room-master identity remains excluded even when its entity has an ordinary name", async () => {
  const { target } = await setup("switch.demo_socket"); await review(target._id);
  await models.Breaker.updateOne({ _id: "BRK-R101" }, { $set: { nativeDeviceId: target.entityId } });
  const result = await mutate(`/connected-devices/${target._id}/off`, { requestId: randomUUID(), action: "off", confirmed: true });
  assert.equal(result.status, 409); assert.equal(result.body.error.code, "MASTER_EXCLUDED");
});
test("first alert and HOD escalation persist, restart recovery finishes native OFF without breaker commands", async () => {
  await autoSetup(); const incident = await finalIncident();
  const jobs = await models.Job.find({ incidentId: incident._id }).sort({ dueAt: 1 }).lean();
  assert.equal(+jobs[1].dueAt - +jobs[0].dueAt, config.firstEscalationMs);
  assert.equal(+jobs[2].dueAt - +jobs[1].dueAt, config.finalAdditionalMs);
  const reopened = await connectDatabase(database.getUri("native_test"));
  try { await tick(reopened.models, config, new Date(), "restarted-native-worker"); }
  finally { await getConnectedDeviceService(reopened.models, config).close(); await reopened.connection.close(); }
  const outcome = await models.Incident.findById(incident._id).lean();
  assert.equal(outcome.state, "resolved", JSON.stringify(outcome)); assert.equal(outcome.resolution.method, "native_simulated");
  assert.ok(outcome.timeline.some((item) => item.event === "second_notification"));
  assert.equal(await models.Command.countDocuments({ incidentId: incident._id }), 0);
});
test("accepted-but-unconfirmed native OFF remains unverified and never falls back to the room breaker", async () => {
  const { target } = await autoSetup("light.demo_unconfirmed"); const incident = await finalIncident();
  await tick(models, config);
  const command = await models.NativeCommand.findOne({ incidentId: incident._id }).lean();
  assert.equal(command.status, "unverified"); assert.equal((await models.Incident.findById(incident._id).lean()).state, "blocked");
  assert.equal(await models.Command.countDocuments(), 0); assert.equal((await models.Breaker.findById("BRK-R101").lean()).reportedSupply, "on");
  // Late matching evidence reconciles history; it does not issue another OFF.
  await service.simulateState(target.connectionId, target.entityId, { state: "off" });
  const reconciled = await models.NativeCommand.findById(command._id).lean(); assert.equal(reconciled.status, "confirmed"); assert.ok(reconciled.timeline.some((row) => row.status === "unverified"));
});
test("bookings, QR leases, overrides and renewed occupancy cancel or protect pending native OFF", async () => {
  const { target } = await setup(); await review(target._id);
  const queued = await mutate(`/connected-devices/${target._id}/off`, { requestId: randomUUID(), action: "off", confirmed: true });
  const booking = await mutate("/schedules", { roomId: "room-r101", title: "Protected class", startAt: new Date().toISOString(), endAt: new Date(Date.now() + 3600000).toISOString() });
  assert.equal(booking.status, 201); await service.processJobs();
  assert.equal((await models.NativeCommand.findById(queued.body.data._id).lean()).status, "cancelled");
  assert.equal((await mutate(`/connected-devices/${target._id}/off`, { requestId: randomUUID(), action: "off", confirmed: true })).status, 409);
  await models.Schedule.deleteMany({ roomId: "room-r101" });
  await models.AccessLease.create({ roomId: "room-r101", requesterId: "demo-teacher", startAt: new Date(), expiresAt: new Date(Date.now() + 60000) });
  assert.equal((await mutate(`/connected-devices/${target._id}/off`, { requestId: randomUUID(), action: "off", confirmed: true })).body.error.code, "ROOM_PROTECTED");
  await models.AccessLease.deleteMany({ roomId: "room-r101" });
  await models.Override.create({ roomId: "room-r101", creatorId: "demo-admin", startAt: new Date(), expiresAt: new Date(Date.now() + 60000), reason: "Staff inspection" });
  assert.equal((await mutate(`/connected-devices/${target._id}/off`, { requestId: randomUUID(), action: "off", confirmed: true })).status, 409);
  await models.Override.deleteMany({ roomId: "room-r101" });
  await models.Observation.create({ sourceId: "CAM-R101", roomId: "room-r101", capturedAt: new Date(), occupancy: "occupied", confidence: 1, coverageValidated: true, quality: { usable: true }, dataMode: "simulated" });
  assert.equal((await mutate(`/connected-devices/${target._id}/off`, { requestId: randomUUID(), action: "off", confirmed: true })).status, 409);
});
test("expired native work and recovered dispatched commands are never sent as outage backlog", async () => {
  const { target } = await setup(); await review(target._id);
  const queued = await mutate(`/connected-devices/${target._id}/off`, { requestId: randomUUID(), action: "off", confirmed: true });
  await models.NativeCommand.updateOne({ _id: queued.body.data._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await service.processJobs(); assert.equal((await models.NativeCommand.findById(queued.body.data._id).lean()).status, "expired");
  const another = await mutate(`/connected-devices/${target._id}/off`, { requestId: randomUUID(), action: "off", confirmed: true });
  await models.NativeCommand.updateOne({ _id: another.body.data._id }, { $set: { status: "dispatched", dispatchedAt: new Date(), evidence: { before: target.lastState } } });
  await service.processJobs(); assert.equal((await models.NativeCommand.findById(another.body.data._id).lean()).status, "unverified");
  assert.equal((await models.SimulatedEntity.findOne({ entityId: target.entityId }).lean()).state, "on");
});
test("disconnect/unregister cancel work, binding review resets control, and external ON suspends repeat automation", async () => {
  const { conn, target } = await autoSetup(); const incident = await finalIncident(); await tick(models, config);
  assert.equal((await models.Incident.findById(incident._id).lean()).state, "resolved");
  await service.simulateState(conn._id, target.entityId, { state: "on" });
  assert.equal((await models.ConnectedDevice.findById(target._id).lean()).automaticOffAllowed, false);
  const rebound = await mutate(`/connected-devices/${target._id}/binding`, { connectionId: conn._id, entityId: "light.demo_unconfirmed", roomId: "room-r101" }, "patch");
  assert.equal(rebound.status, 200); assert.equal(rebound.body.data.manualOffAllowed, false);
  await review(target._id);
  const queued = await mutate(`/connected-devices/${target._id}/off`, { requestId: randomUUID(), action: "off", confirmed: true }); assert.equal(queued.status, 202);
  assert.equal((await mutate(`/device-connections/${conn._id}`, { enabled: false }, "patch")).status, 200);
  assert.equal((await models.NativeCommand.findById(queued.body.data._id).lean()).status, "cancelled");
  assert.equal((await mutate(`/connected-devices/${target._id}/unregister`, {})).status, 200);
});
test("live token is encrypted/write-only, rejected tokens are redacted, and demo mode blocks live control", async () => {
  const mock = await startHomeAssistantMock(); config.haAllowedOrigins = [mock.origin]; config.haAllowHttp = true; config.haAllowLoopback = true;
  try {
    const created = await mutate("/device-connections", { name: "Protocol gateway", provider: "home_assistant", baseUrl: mock.origin, token: mock.token });
    assert.equal(created.status, 201); assert.ok(!JSON.stringify(created.body).includes(mock.token));
    const id = created.body.data._id, saved = await models.DeviceConnection.findById(id).select("+tokenCipher").lean();
    assert.ok(saved.tokenCipher.data); assert.ok(!JSON.stringify(saved).includes(mock.token));
    assert.equal((await mutate(`/device-connections/${id}/test`, {})).status, 200);
    assert.ok(!JSON.stringify((await admin.get("/api/v1/device-connections")).body).includes(mock.token));
    assert.equal((await mutate(`/device-connections/${id}/live-permission`, { enabled: true })).status, 409);
    assert.equal(mock.requests.filter((r) => r.method === "POST").length, 0);
    await service.updateConnection(id, { token: "wrong-mock-token" }, "demo-admin");
    const rejected = await mutate(`/device-connections/${id}/test`, {}); assert.equal(rejected.status, 502); assert.equal(rejected.body.error.code, "AUTHENTICATION");
    assert.ok(!JSON.stringify(rejected.body).includes("wrong-mock-token"));
    await service.updateConnection(id, { enabled: false }, "demo-admin");
  } finally { await mock.close(); }
});
test("live controls require all gates and live vacancy; protocol-mock OFF is provider-reported, never physically verified", async () => {
  const mock = await startHomeAssistantMock();
  const liveConfig = { ...config, demoMode: false, timeScale: 1, allowNativeControl: true, haAllowedOrigins: [mock.origin], haAllowHttp: true, haAllowLoopback: true };
  const live = getConnectedDeviceService(models, liveConfig);
  try {
    const conn = await live.createConnection({ name: "Live protocol mock", provider: "home_assistant", baseUrl: mock.origin, token: mock.token }, "demo-admin");
    await live.testConnection(conn._id);
    for (let i = 0; i < 100 && (await models.DeviceConnection.findById(conn._id).lean()).socketHealth !== "online"; i++) await new Promise((r) => setTimeout(r, 20));
    await live.setLivePermission(conn._id, true, "demo-admin");
    const target = await live.register({ connectionId: conn._id, entityId: "light.protocol_test", roomId: "room-r101" }, "demo-admin");
    await live.review(target._id, { classification: "ordinary", identityReviewed: true, capabilityReviewed: true, manualOffAllowed: true, reviewNotes: "Protocol mock only; no actual equipment" }, "demo-admin");
    await assert.rejects(() => live.requestOff(target._id, randomUUID(), "demo-admin"), { code: "ROOM_PROTECTED" });
    await vacancy("live");
    const command = await live.requestOff(target._id, randomUUID(), "demo-admin"); await live.processJobs();
    const result = await models.NativeCommand.findById(command._id).lean();
    assert.equal(result.status, "confirmed", JSON.stringify(result)); assert.equal(result.verification, "provider_reported_off");
    assert.equal(mock.requests.filter((r) => r.method === "POST").length, 1);
    assert.ok(!mock.requests.some((r) => r.method === "POST" && r.path.includes("/states/")));
    assert.equal(await models.Command.countDocuments(), 0);
  } finally { await live.close(); await mock.close(); }
});
test("a required native shutdown blocks dependent breaker commands until freshly confirmed", async () => {
  const { conn, target } = await setup(); const inventory = await models.Device.findOne({ roomId: "room-r101" }).lean();
  await service.rebind(target._id, { connectionId: conn._id, entityId: target.entityId, roomId: target.roomId, inventoryId: inventory._id }, "demo-admin");
  await models.Device.updateOne({ _id: inventory._id }, { $set: { nativeOffRequired: true } });
  await review(target._id);
  const master = createRoomMaster(models, config), input = { requestId: randomUUID(), action: "off", reason: "staff_override" };
  await assert.rejects(() => master.setSupply("room-r101", input, "demo-admin"), /required native shutdown is unverified/);
  await off(target._id);
  const result = await master.setSupply("room-r101", input, "demo-admin"); assert.equal(result.result.verification, "simulated");
});
test("simulation never calls a live gateway even if a client supplies live connection fields", async () => {
  const mock = await startHomeAssistantMock();
  try {
    const conn = await service.createConnection({ name: "Strict simulator", provider: "simulator", baseUrl: mock.origin, token: mock.token }, "demo-admin");
    await service.testConnection(conn._id); await service.discover(conn._id);
    const target = await service.register({ connectionId: conn._id, entityId: "light.demo_lecture", roomId: "room-r101" }, "demo-admin");
    await review(target._id); await off(target._id);
    assert.deepEqual(mock.requests, []);
  } finally { await mock.close(); }
});
test("removed/renamed entities disable control and late evidence cannot confirm a replaced binding", async () => {
  const { conn, target } = await setup("light.demo_unconfirmed"); await review(target._id);
  const command = await off(target._id); assert.equal(command.status, "unverified");
  await service.observeState(conn._id, target.entityId, {}, true);
  const missing = await models.ConnectedDevice.findById(target._id).lean(); assert.equal(missing.identityStatus, "missing"); assert.equal(missing.manualOffAllowed, false);
  const rebound = await service.rebind(target._id, { connectionId: conn._id, entityId: "light.demo_lecture", roomId: target.roomId }, "demo-admin");
  assert.equal(rebound.identityStatus, "unreviewed");
  await service.simulateState(conn._id, "light.demo_lecture", { state: "off" });
  assert.equal((await models.NativeCommand.findById(command._id).lean()).status, "unverified");
});
