import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import request from "supertest";
import { io } from "socket.io-client";
import { startDatabase } from "../scripts/database.mjs";
import { loadConfig } from "../backend/src/config.js";
import { createInstitutionApplication } from "../backend/src/workspaces/runtime.js";
import { connectDatabase, createModels } from "../backend/src/models/index.js";
import { startLiveSync } from "../frontend/src/services/live-sync.js";
let db, runtime, a, b, viewer, sockets = [], base;
const origin = "http://localhost:5000", password = randomBytes(24).toString("base64url"), adminKey = randomInt(10000000, 100000000).toString();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) { for (let i = 0; i < 100; i++) { if (await fn()) return; await delay(60); } throw new Error("Timed out waiting for scoped synchronisation"); }
async function account(body) {
  const agent = request.agent(runtime.app), csrf = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
  const result = await agent.post("/api/v1/auth/register").set("Origin", origin).set("X-CSRF-Token", csrf).send({ name: "Test member", password, ...body });
  assert.equal(result.status, 201);
  return { agent, csrf: result.body.data.csrfToken, user: result.body.data.user, id: result.body.data.institution._id, cookie: result.headers["set-cookie"].map(row => row.split(";")[0]).join("; ") };
}
const write = (member, path, body, method = "post") => member.agent[method](`/api/v1${path}`).set("Origin", origin).set("X-CSRF-Token", member.csrf).send(body);
async function socketFor(member) {
  const socket = io(base, { forceNew: true, transports: ["websocket"], extraHeaders: { Cookie: member.cookie, Origin: origin }, reconnection: false });
  const events = [], resets = []; socket.on("sync:change", event => events.push(event)); socket.on("sync:reset", event => resets.push(event));
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
  await until(() => resets.length); sockets.push(socket); return { socket, events, resets };
}
before(async () => {
  db = await startDatabase(); runtime = await createInstitutionApplication(loadConfig({ NODE_ENV: "test", MONGODB_URI: db.getUri("realtime_directory"), ADMIN_INVITE_KEY: adminKey, SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), PUBLIC_APP_URL: origin, FRONTEND_ORIGIN: origin }));
  await new Promise(resolve => runtime.server.listen(0, "127.0.0.1", resolve)); base = `http://127.0.0.1:${runtime.server.address().port}`;
  a = await account({ email: "a@live.test", institutionName: "Alpha live", adminKey }); b = await account({ email: "b@live.test", institutionName: "Beta live", adminKey });
  for (const member of [a, b]) {
    const realm = await runtime.directory.realm(member.id);
    await realm.models.Room.create({ _id: "same-room", code: "R1", name: "Original room", roomBreakerId: "same-master" });
    await realm.models.Breaker.create({ _id: "same-master", roomId: "same-room" });
  }
  const invite = await write(a, "/institutions/current/invitations", { role: "viewer", email: "viewer@live.test", permittedRoomIds: ["same-room"], expiresInHours: 1 });
  viewer = await account({ email: "viewer@live.test", invitationToken: invite.body.data.token });
});
after(async () => { for (const socket of sockets) socket.disconnect(); await runtime?.close(); await db?.stop(); });

test("persisted action invalidates independent administrator/viewer sessions without crossing institutions or granting viewer writes", async () => {
  const [admin, reader, foreign] = await Promise.all([socketFor(a), socketFor(viewer), socketFor(b)]);
  const response = await write(a, "/rooms/same-room", { name: "Updated live room" }, "patch"); assert.equal(response.status, 200);
  await until(() => admin.events.some(e => e.resource === "rooms") && reader.events.some(e => e.resource === "rooms"));
  await delay(700); assert.equal(foreign.events.filter(e => e.resource === "rooms").length, 0);
  assert.equal((await viewer.agent.get("/api/v1/rooms/same-room")).body.data.name, "Updated live room");
  assert.equal((await write(viewer, "/rooms/same-room", { name: "Denied" }, "patch")).status, 403);
  const event = reader.events.find(e => e.resource === "rooms"); assert.equal(event.institutionId, a.id); assert.equal(event.entityId, "same-room");
  assert.ok(!JSON.stringify(event).includes("Updated live room"));
  const before = admin.events.length;
  assert.equal((await write(a, "/rooms/same-room", { invalidProperty: true }, "patch")).status, 400);
  await delay(700); assert.equal(admin.events.length, before);
});

test("all required persisted resource changes share the feed; native requests, failure and simulator ACK remain distinct", async () => {
  const listener = await socketFor(a), realm = await runtime.directory.realm(a.id), m = realm.models;
  await m.Schedule.create({ roomId: "same-room", title: "Live class", startAt: new Date(), endAt: new Date(Date.now() + 60000) });
  await m.AccessLease.create({ roomId: "same-room", requesterId: a.user._id, startAt: new Date(), expiresAt: new Date(Date.now() + 60000) });
  await m.Override.create({ roomId: "same-room", creatorId: a.user._id, reason: "Test", startAt: new Date(), expiresAt: new Date(Date.now() + 60000) });
  const incident = await m.Incident.create({ roomId: "same-room", issueKey: randomUUID(), title: "Test", state: "open" });
  await m.Incident.updateOne({ _id: incident._id }, { $set: { acknowledgedBy: a.user._id, state: "acknowledged" } });
  await m.Notification.create({ roomId: "same-room", recipientId: viewer.user._id, title: "Test", idempotencyKey: randomUUID(), state: "sent" });
  await m.Floor.create({ code: "F1", name: "First" });
  await m.Breaker.updateOne({ _id: "same-master" }, { $set: { reportedSupply: "off" } });
  const native = await m.NativeCommand.create({ requestId: randomUUID(), roomId: "same-room", status: "requested", verification: "unknown", mode: "simulated" });
  await m.NativeCommand.updateOne({ _id: native._id }, { $set: { status: "failed", errorCode: "UNAVAILABLE" } });
  const command = await m.Command.create({ requestId: randomUUID(), roomId: "same-room", state: "pending" });
  await m.Command.updateOne({ _id: command._id }, { $set: { state: "completed", result: { verification: "simulator_acknowledged" } } });
  for (const resource of ["schedules", "qr-leases", "overrides", "incidents", "notifications", "floors", "room-master", "native-commands", "master-commands"])
    await until(() => listener.events.some(e => e.resource === resource));
  await until(() => listener.events.some(e => e.phase === "failed") && listener.events.some(e => e.verification === "simulator_acknowledged"));
  const nativeEvents = listener.events.filter(e => e.entityId === native._id);
  assert.deepEqual(nativeEvents.map(e => e.phase), ["requested", "failed"]); assert.ok(nativeEvents.every(e => !["confirmed", "provider_reported_off"].includes(e.verification)));
  assert.equal(new Set(listener.events.map(e => e.eventId)).size, listener.events.length);
});

test("independent background connection emits equivalent changes and reconnect obtains authorised current snapshot", async () => {
  const listener = await socketFor(viewer), realm = await runtime.directory.realm(a.id);
  const external = await connectDatabase(db.getUri(realm.connection.name));
  try {
    const m = createModels(external.connection, a.id);
    await m.Job.create({ _id: "external-job", roomId: "same-room", status: "pending" });
    await m.ConnectedDevice.create({ _id: "external-device", connectionId: "external", entityId: "light.external", roomId: "same-room", lastState: { state: "off", source: "home_assistant", observedAt: new Date() } });
    await until(() => listener.events.some(e => e.resource === "jobs") && listener.events.some(e => e.resource === "native-devices"));
    listener.socket.disconnect();
    await m.Room.updateOne({ _id: "same-room" }, { $set: { name: "Changed while disconnected" } });
    await write(a, "/institutions/current", { displayName: "Renamed live institution" }, "patch");
    const reconnected = await socketFor(viewer); assert.equal(reconnected.resets[0].reason, "connected");
    const snapshot = await viewer.agent.get("/api/v1/sync/snapshot"); assert.equal(snapshot.status, 200); assert.equal(snapshot.body.data.user.institution.displayName, "Renamed live institution");
    assert.equal((await viewer.agent.get("/api/v1/rooms/same-room")).body.data.name, "Changed while disconnected");
    assert.equal(snapshot.body.data.institutionId, a.id);
  } finally { await external.connection.close(); }
});

test("room permission changes remove subscriptions and session/membership revocation disconnects the socket", async () => {
  const reader = await socketFor(viewer), realm = await runtime.directory.realm(a.id);
  assert.equal((await new Promise(resolve => reader.socket.emit("subscribe-room", "same-room", resolve))).ok, true);
  await realm.models.User.updateOne({ _id: viewer.user._id }, { $set: { permittedRoomIds: [] } });
  await until(() => reader.resets.some(e => e.reason === "permissions_changed"));
  const start = reader.events.length;
  await realm.models.Room.updateOne({ _id: "same-room" }, { $set: { name: "No longer visible" } });
  await delay(800); assert.equal(reader.events.length, start);
  const serverSocket = runtime.io.sockets.sockets.get(reader.socket.id); assert.ok(![...serverSocket.rooms].some(room => room.startsWith("room:")));
  assert.equal((await new Promise(resolve => reader.socket.emit("subscribe-room", "same-room", resolve))).ok, false);
  await runtime.directory.Membership.updateOne({ userId: viewer.user._id, institutionId: a.id }, { $set: { active: false } });
  await until(() => !reader.socket.connected);
  assert.equal((await viewer.agent.get("/api/v1/sync/snapshot")).status, 401);
});

test("frontend coalesces ordered invalidations, reconciles background/reconnect, rejects late snapshots and cleans every handler", async () => {
  class FakeSocket extends EventEmitter { connected = false; connect() { this.connected = true; this.emit("connect"); } disconnect() { this.connected = false; this.emit("disconnect"); } }
  const socket = new FakeSocket(), environment = new EventTarget(); environment.document = new EventTarget(); environment.document.visibilityState = "visible";
  const states = []; let reads = 0, invalidations = 0, identityCalls = 0, serverRevision = 10;
  const dispose = startLiveSync({ socket, environment, request: async () => { reads++; return { institutionId: "alpha", revision: serverRevision, user: { _id: "member" } }; }, invalidate: () => invalidations++, identity: () => identityCalls++, status: value => states.push(value), revoked: () => assert.fail("Unexpected revoke") });
  await until(() => invalidations === 1);
  socket.emit("sync:change", { institutionId: "beta", revision: 999 });
  socket.emit("sync:change", { institutionId: "alpha", revision: 9 });
  await delay(160); assert.equal(reads, 1);
  serverRevision = 12;
  for (const revision of [11, 12, 11, 12]) socket.emit("sync:change", { institutionId: "alpha", revision });
  await until(() => invalidations === 2); assert.equal(reads, 2);
  environment.document.visibilityState = "hidden"; environment.document.dispatchEvent(new Event("visibilitychange")); assert.equal(states.at(-1), "background");
  serverRevision = 13; socket.emit("sync:change", { institutionId: "alpha", revision: 13 }); await delay(180); assert.equal(reads, 2);
  environment.document.visibilityState = "visible"; environment.document.dispatchEvent(new Event("visibilitychange")); await until(() => invalidations === 3);
  socket.disconnect(); assert.equal(states.at(-1), "disconnected"); socket.connect(); await until(() => invalidations === 4);
  environment.dispatchEvent(new Event("pagehide")); assert.equal(socket.connected, false); assert.equal(states.at(-1), "background");
  environment.dispatchEvent(new Event("pageshow")); await until(() => invalidations === 5);
  dispose(); assert.equal(socket.listenerCount("sync:change"), 0); assert.equal(socket.listenerCount("connect"), 0);
  environment.dispatchEvent(new Event("focus")); await delay(150); assert.equal(identityCalls, 5);
});

test("an in-flight snapshot older than a received revision cannot replace identity; aborted requests cannot apply", async () => {
  class FakeSocket extends EventEmitter { connected = true; connect() { this.emit("connect"); } disconnect() {} }
  const socket = new FakeSocket(), environment = new EventTarget(); environment.document = new EventTarget(); environment.document.visibilityState = "visible";
  let resolveOld, reads = 0; const identities = [];
  const stop = startLiveSync({ socket, environment, request: async () => { reads++; if (reads === 1) return new Promise(resolve => { resolveOld = resolve; }); return { institutionId: "alpha", revision: 2, user: { name: "New" } }; }, identity: value => identities.push(value.name), invalidate: () => {}, status: () => {}, revoked: () => {} });
  socket.institutionId = "alpha"; socket.emit("sync:change", { institutionId: "alpha", revision: 2 });
  resolveOld({ institutionId: "alpha", revision: 1, user: { name: "Old" } });
  await until(() => identities.length); assert.deepEqual(identities, ["New"]); stop();
  const abortedSocket = new FakeSocket(); let resolveAborted;
  const dispose = startLiveSync({ socket: abortedSocket, environment, request: () => new Promise(resolve => { resolveAborted = resolve; }), identity: () => assert.fail("Disposed snapshot applied"), invalidate: () => {}, status: () => {}, revoked: () => {} });
  dispose(); resolveAborted({ institutionId: "alpha", revision: 3, user: {} }); await delay(150);
  let revoked = false;
  const disposeWrong = startLiveSync({ socket: new FakeSocket(), environment, expectedInstitutionId: "alpha", request: async () => ({ institutionId: "beta", revision: 5, user: {} }), identity: () => assert.fail("Switched workspace without authorisation"), invalidate: () => {}, status: () => {}, revoked: () => { revoked = true; } });
  await until(() => revoked); disposeWrong();
});
