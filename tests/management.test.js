import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomBytes, randomInt } from "node:crypto";
import { startDatabase } from "../scripts/database.mjs";
import { connectDatabase } from "../backend/src/models/index.js";
import { loadConfig } from "../backend/src/config.js";
import { createApplication } from "../backend/src/app.js";
import { seed } from "../backend/src/seed.js";
let db, connection, models, runtime, config, admin, csrf, floorId, roomId;
const password = randomBytes(18).toString("hex"), adminKey = randomInt(10000000, 100000000).toString();
const origin = "http://localhost:5000";
const mutate = (agent, token, path, body, method = "post") => agent[method](`/api/v1${path}`).set("Origin", origin).set("X-CSRF-Token", token).send(body);
async function authenticate(email, key, agent = request.agent(runtime.app)) {
  const { body } = await agent.get("/api/v1/auth/csrf");
  const response = await mutate(agent, body.data.csrfToken, "/auth/login", { email, password, ...(key !== undefined ? { adminKey: key } : {}) });
  return { agent, response, token: response.body.data?.csrfToken ?? body.data.csrfToken };
}
before(async () => {
  db = await startDatabase();
  ({ connection, models } = await connectDatabase(db.getUri("management_test")));
  config = loadConfig({ NODE_ENV: "test", MONGODB_URI: db.getUri("management_test"), SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), ADMIN_INVITE_KEY: adminKey, DEMO_MODE: "true", PUBLIC_APP_URL: origin });
  await seed(models, config, { password });
  runtime = createApplication({ config, connection, models });
  const login = await authenticate("admin@campus.test", adminKey);
  assert.equal(login.response.status, 200); admin = login.agent; csrf = login.token;
});
after(async () => { if (runtime) await runtime.close(); if (connection) await connection.close(); if (db) await db.stop(); });

test("admin registration rejects a wrong key without creating a viewer fallback", async () => {
  const agent = request.agent(runtime.app), token = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
  const result = await mutate(agent, token, "/auth/register", { name: "Rejected admin", email: "invalid-key@test.example", password, adminKey: "wrong-key" });
  assert.equal(result.status, 403); assert.equal(result.body.error.code, "INVALID_ADMIN_KEY");
  assert.equal(await models.User.countDocuments({ email: "invalid-key@test.example" }), 0);
});
test("valid admin registration persists the role and returns an admin session", async () => {
  const agent = request.agent(runtime.app), token = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
  const result = await mutate(agent, token, "/auth/register", { name: "New admin", email: "valid-admin@test.example", password, adminKey });
  assert.equal(result.status, 201); assert.equal(result.body.data.user.role, "admin");
  assert.equal((await agent.get("/api/v1/auth/me")).body.data.user.role, "admin");
  assert.equal((await agent.get("/api/v1/management/building")).status, 200);
  assert.ok(!JSON.stringify(result.body).includes("passwordHash"));
});
test("admin login needs both a correct password and the current admin key", async () => {
  for (const key of [undefined, "wrong-key"]) {
    const { agent, response } = await authenticate("admin@campus.test", key);
    assert.equal(response.status, 403); assert.equal((await agent.get("/api/v1/auth/me")).status, 401);
  }
  const { response } = await authenticate("admin@campus.test", adminKey);
  assert.equal(response.status, 200); assert.equal(response.body.data.user.role, "admin");
});
test("viewer can only activate admin access with their password and a valid key; session rotates", async () => {
  const login = await authenticate("viewer@campus.test");
  assert.equal(login.response.body.data.user.role, "viewer");
  const failed = await mutate(login.agent, login.token, "/auth/login", { email: "viewer@campus.test", password, adminKey: "incorrect" });
  assert.equal(failed.status, 403); assert.equal((await models.User.findById("demo-viewer").lean()).role, "viewer");
  const oldCookie = login.response.headers["set-cookie"]?.[0];
  const upgraded = await mutate(login.agent, login.token, "/auth/login", { email: "viewer@campus.test", password, adminKey });
  assert.equal(upgraded.status, 200); assert.equal(upgraded.body.data.user.role, "admin");
  assert.notEqual(upgraded.headers["set-cookie"]?.[0], oldCookie);
  assert.equal((await login.agent.get("/api/v1/management/building")).status, 200);
  assert.equal(await models.AuditEvent.countDocuments({ actorId: "demo-viewer", action: "auth.admin_access_granted" }), 1);
});
test("non-admin routes remain usable; management writes and profile role forgery are forbidden", async () => {
  const { agent, token, response } = await authenticate("teacher@campus.test");
  assert.equal(response.status, 200);
  assert.equal((await agent.get("/api/v1/management/building")).status, 403);
  assert.equal((await mutate(agent, token, "/management/floors", { name: "Forbidden", code: "FORBIDDEN" })).status, 403);
  assert.equal((await mutate(agent, token, "/auth/profile", { name: "Name", role: "admin" }, "patch")).status, 400);
  const profile = await mutate(agent, token, "/auth/profile", { name: "Renamed teacher" }, "patch");
  assert.equal(profile.status, 200); assert.equal(profile.body.data.user.role, "teacher");
});
test("existing sessions do not acquire administrator permissions from a database role change alone", async () => {
  const { agent } = await authenticate("hod@campus.test");
  await models.User.updateOne({ _id: "demo-hod" }, { $set: { role: "admin" } });
  assert.equal((await agent.get("/api/v1/auth/me")).status, 401);
  assert.equal((await agent.get("/api/v1/management/building")).status, 401);
});
test("administrator cannot deactivate or demote their own active account", async () => {
  assert.equal((await mutate(admin, csrf, "/users/demo-admin", { active: false }, "patch")).status, 409);
  assert.equal((await mutate(admin, csrf, "/users/demo-admin", { role: "viewer" }, "patch")).status, 409);
  assert.equal((await models.User.findById("demo-admin").lean()).role, "admin");
});
test("building and floor setup persists; floor rename retains identity and duplicate codes fail", async () => {
  const building = await mutate(admin, csrf, "/management/building", { installationName: "Academic Block", organisationName: "Demo College", contactEmail: "facilities@example.test", buildingType: "college", address: "Campus road" }, "put");
  assert.equal(building.status, 200); assert.equal(building.body.data.setupCompleted, true);
  const floor = await mutate(admin, csrf, "/management/floors", { name: "Ground Floor", code: "FL-00", order: 0 });
  assert.equal(floor.status, 201); floorId = floor.body.data._id;
  const rename = await mutate(admin, csrf, `/management/floors/${floorId}`, { name: "Teaching Floor" }, "patch");
  assert.equal(rename.status, 200); assert.equal(rename.body.data._id, floorId);
  assert.equal((await mutate(admin, csrf, "/management/floors", { name: "Duplicate", code: "FL-00" })).status, 409);
  const saved = await admin.get("/api/v1/management/building");
  assert.equal(saved.body.data.building.organisationName, "Demo College"); assert.equal(saved.body.data.floors[0].name, "Teaching Floor");
});
test("space creation validates floor, preserves room and master IDs through rename and floor moves", async () => {
  const invalid = await mutate(admin, csrf, "/rooms", { name: "Bad room", code: "BAD", roomBreakerId: "BRK-BAD", floorId: "missing-floor" });
  assert.equal(invalid.status, 400);
  const created = await mutate(admin, csrf, "/rooms", { name: "Computer Lab", code: "LAB-001", floorId, spaceType: "laboratory", cameraConfiguration: "none", roomBreakerId: "BRK-LAB-001" });
  assert.equal(created.status, 201, JSON.stringify(created.body)); roomId = created.body.data._id;
  const rename = await mutate(admin, csrf, `/rooms/${roomId}`, { name: "Renamed lab", floorId: null }, "patch");
  assert.equal(rename.status, 200); assert.equal(rename.body.data._id, roomId); assert.equal(rename.body.data.roomBreakerId, "BRK-LAB-001");
  assert.equal((await models.Breaker.findById("BRK-LAB-001").lean()).roomId, roomId);
});
test("camera creation maps to a stable room; no-camera choice invalidates coverage and cancels stale work", async () => {
  const mapped = await mutate(admin, csrf, "/management/cameras", { roomId, name: "Lab camera simulation", connectionMethod: "simulation" });
  assert.equal(mapped.status, 201); assert.equal(mapped.body.data.integration.capabilities.fixtureReplay, true);
  let room = await models.Room.findById(roomId).lean();
  assert.ok(room.requiredSourceIds.includes(mapped.body.data.integration._id)); assert.equal(room.coverageValidated, false);
  const noCamera = await mutate(admin, csrf, `/rooms/${roomId}`, { cameraConfiguration: "none" }, "patch");
  assert.equal(noCamera.status, 200); assert.deepEqual(noCamera.body.data.requiredSourceIds, []);
  const context = await admin.get(`/api/v1/rooms/${roomId}/status`);
  assert.equal(context.body.data.observed.state, "unknown");
  const invalid = await mutate(admin, csrf, "/management/cameras", { roomId: "missing-room", name: "Invalid", connectionMethod: "simulation" });
  assert.equal(invalid.status, 404);
});
test("controller configuration preserves one-room mapping and cannot request physical transport", async () => {
  const saved = await mutate(admin, csrf, "/management/controllers/BRK-LAB-001", { name: "Lab master", manufacturer: "Demo manufacturer", nativeDeviceId: "demo-device-001" }, "patch");
  assert.equal(saved.status, 200); assert.equal(saved.body.data.roomId, roomId); assert.equal(saved.body.data.adapter, "simulator");
  assert.equal((await mutate(admin, csrf, "/management/controllers/BRK-LAB-001", { adapter: "physical", roomId: "room-r101" }, "patch")).status, 400);
  const tested = await mutate(admin, csrf, "/management/controllers/BRK-LAB-001/test", {});
  assert.equal(tested.body.data.simulated, true);
  const state = await admin.get("/api/v1/management/automation");
  assert.equal(state.status, 200); assert.ok(state.body.data.rooms.some((r) => r.id === roomId)); assert.equal(state.body.data.simulated, true);
});
test("bulk floor and space generation retains existing records and rejects overlapping codes", async () => {
  const original = await models.Room.findById(roomId).lean();
  const floors = await mutate(admin, csrf, "/management/floors/generate", { count: 2 });
  assert.equal(floors.status, 201); assert.equal(floors.body.data.length, 2);
  assert.ok(floors.body.data.every((floor) => floor._id !== floorId));
  const generated = await mutate(admin, csrf, `/management/floors/${floorId}/spaces`, { count: 3, prefix: "COR", startNumber: 101, spaceType: "corridor", capacity: 0 });
  assert.equal(generated.status, 201); assert.equal(generated.body.data.length, 3);
  assert.equal(await models.Room.countDocuments({ code: { $in: ["COR-101", "COR-102", "COR-103"] } }), 3);
  assert.equal(await models.Breaker.countDocuments({ roomId: { $in: generated.body.data.map((room) => room._id) } }), 3);
  const duplicate = await mutate(admin, csrf, `/management/floors/${floorId}/spaces`, { count: 4, prefix: "COR", startNumber: 101, spaceType: "corridor", capacity: 0 });
  assert.equal(duplicate.status, 409); assert.equal(await models.Room.countDocuments({ code: "COR-104" }), 0);
  assert.equal((await models.Room.findById(roomId).lean()).name, original.name);
});
test("gateway camera registration issues a scoped one-time credential without leaking it on reads", async () => {
  const result = await mutate(admin, csrf, "/management/cameras", { roomId, name: "Gateway camera", connectionMethod: "gateway" });
  assert.equal(result.status, 201); assert.ok(result.body.data.serviceToken);
  const sources = await admin.get("/api/v1/integrations");
  assert.ok(!JSON.stringify(sources.body).includes(result.body.data.serviceToken));
  assert.equal(result.body.data.integration.health, "unavailable");
});
test("disabled admin invitation configuration rejects supplied keys explicitly", async () => {
  const disabled = createApplication({ config: { ...config, adminInviteKey: null }, connection, models });
  try {
    const agent = request.agent(disabled.app), token = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
    const registered = await mutate(agent, token, "/auth/register", { name: "No invite", email: "disabled@test.example", password, adminKey });
    assert.equal(registered.status, 503); assert.equal(await models.User.countDocuments({ email: "disabled@test.example" }), 0);
  } finally { await disabled.close(); }
});
