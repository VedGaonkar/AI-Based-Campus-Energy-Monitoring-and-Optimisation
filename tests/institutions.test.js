import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomInt, createHmac } from "node:crypto";
import request from "supertest";
import { io as socketClient } from "socket.io-client";
import { startDatabase } from "../scripts/database.mjs";
import { loadConfig } from "../backend/src/config.js";
import { createInstitutionApplication } from "../backend/src/workspaces/runtime.js";
import { seedDedicatedDemo } from "../backend/src/workspaces/demo-seed.js";
import { migrateLegacyInstallation } from "../backend/src/workspaces/migration.js";
import { connectDatabase } from "../backend/src/models/index.js";
import { createInstitutionDirectory } from "../backend/src/workspaces/directory.js";
import { tick } from "../backend/src/workers/tick.js";

let db, runtime, directory, config, a, b, port;
const password = randomBytes(24).toString("base64url"), adminKey = randomBytes(24).toString("hex");
const origin = "http://localhost:5000";
const mutate = (account, path, body = {}, method = "post") => account.agent[method](`/api/v1${path}`).set("Origin", origin).set("X-CSRF-Token", account.csrf).send(body);
async function guest() { const agent = request.agent(runtime.app); return { agent, csrf: (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken }; }
async function register(email, institutionName, discoverable) {
  const account = await guest();
  const response = await mutate(account, "/auth/register", { name: institutionName, email, password, confirmPassword: password, accountType: "administrator", institutionName, adminKey, joinCode: `Building-${email.replaceAll("@", "_").replaceAll(".", "_")}-2026` });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { ...account, csrf: response.body.data.csrfToken, id: response.body.data.institution._id, user: response.body.data.user, email };
}
async function login(email, institutionId, _unused, suppliedPassword = password) {
 const account = await guest(); let response = await mutate(account, "/auth/login", { email, password: suppliedPassword }); account.csrf = response.body.data?.csrfToken ?? account.csrf;
 if (response.body.data?.selectionRequired && institutionId) { response = await mutate(account, "/auth/select-workspace", { institutionId }); account.csrf = response.body.data?.csrfToken ?? account.csrf; }
 return { account: { ...account, id: institutionId }, response };
}

before(async () => {
  db = await startDatabase();
  config = loadConfig({ NODE_ENV: "test", ADMIN_INVITE_KEY: adminKey, MONGODB_URI: db.getUri("workspace_directory"), SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), PUBLIC_APP_URL: origin, FRONTEND_ORIGIN: origin });
  runtime = await createInstitutionApplication(config); directory = runtime.directory;
  await new Promise(resolve => runtime.server.listen(0, "127.0.0.1", resolve)); port = runtime.server.address().port;
  a = await register("admin-a@workspace.test", "Alpha Institute", true);
  b = await register("admin-b@workspace.test", "Beta Private Institute", false);
});
after(async () => { await runtime?.close(); await db?.stop(); });

test("new administrators own immutable separate institution IDs and start with empty operational databases", async () => {
  assert.notEqual(a.id, b.id);
  for (const account of [a, b]) {
    for (const path of ["/rooms", "/devices", "/schedules", "/meter-readings", "/incidents", "/notifications", "/connected-devices", "/device-connections"]) {
      const response = await account.agent.get(`/api/v1${path}`); assert.equal(response.status, 200, JSON.stringify(response.body)); assert.deepEqual(response.body.data, [], path);
    }
    const realm = await directory.realm(account.id);
    assert.equal(await realm.models.Floor.countDocuments(), 0); assert.equal(await realm.models.Job.countDocuments(), 0); assert.equal(await realm.models.Report.countDocuments(), 0);
    assert.equal((await account.agent.get("/api/v1/settings")).body.data.installationName, account.user.name);
    assert.equal(account.user.institutionId, account.id);
  }
  assert.throws(() => directory.models.Room, /Select an authorised institution workspace/);
});

test("registration rejects role/building and retired-flow fields without a partial account", async () => {
 const visitor = await guest(), before = await directory.Account.countDocuments();
 for (const extra of [{ role: "admin" }, { institutionId: a.id }, { invitationToken: "retired" }, { adminKey: "retired" }, { institutionName: "Existing" }]) assert.equal((await mutate(visitor, "/auth/register", { name: "Rejected", email: "injected@workspace.test", password, confirmPassword: password, accountType: "viewer", joinCode: "Unknown-Building-Code-2026", ...extra })).status, 400);
 assert.equal(await directory.Account.countDocuments(), before);
});

test("discovery and invitation endpoints are retired and foreign workspace selection denied", async () => {
 assert.equal((await request(runtime.app).get("/api/v1/institutions/suggestions?q=Alpha")).status, 410);
 const visitor = await guest(); for (const path of ["/institutions/resolve", "/auth/accept-invitation"]) assert.equal((await mutate(visitor, path, {})).status, 410);
 for (const path of ["/institutions/current/access-code", "/institutions/current/invitations"]) assert.equal((await mutate(a, path)).status, 410);
 assert.equal((await mutate(a, "/auth/select-workspace", { institutionId: b.id })).status, 403);
});

test("database isolation covers overlapping local IDs, cross-workspace read/write, filters, exports and integration caches", async () => {
  for (const [account, name] of [[a, "Alpha room"], [b, "Beta room"]]) {
    const realm = await directory.realm(account.id);
    await realm.models.Room.create({ _id: "shared-room-id", code: "R1", name, roomBreakerId: "shared-master", independentInfrastructure: true });
    await realm.models.Breaker.create({ _id: "shared-master", roomId: "shared-room-id" });
    await realm.models.Device.create({ _id: "shared-device", roomId: "shared-room-id", name, supplyInterruptionApproved: true, essential: false });
    await realm.models.Report.create({ _id: "shared-report", name, dataMode: "simulated", payload: { owner: account.id } });
  }
  const realmB = await directory.realm(b.id);
  await realmB.models.Room.create({ _id: "beta-only-room", code: "B2", name: "Private Beta", roomBreakerId: "beta-master" });
  assert.equal((await a.agent.get("/api/v1/rooms/shared-room-id")).body.data.name, "Alpha room");
  assert.equal((await a.agent.get("/api/v1/rooms/beta-only-room")).status, 404);
  assert.equal((await mutate(a, "/rooms/beta-only-room", { name: "Attack" }, "patch")).status, 404);
  const list = await a.agent.get(`/api/v1/rooms?institutionId=${b.id}`); assert.ok(list.body.data.every(room => room.institutionId === a.id));
  assert.equal((await mutate(a, "/rooms/shared-room-id", { institutionId: b.id }, "patch")).status, 400);
  for (const account of [a, b]) {
    const connection = await mutate(account, "/device-connections", { name: "Shared label", provider: "simulator" }); assert.equal(connection.status, 201);
    assert.equal((await mutate(account, `/device-connections/${connection.body.data._id}/test`)).status, 200);
    const other = account === a ? b : a;
    assert.equal((await mutate(other, `/device-connections/${connection.body.data._id}/test`)).status, 404);
  }
  assert.ok((await a.agent.get("/api/v1/management/automation")).body.data.rooms.every(room => room.name !== "Private Beta"));
});

test("rename and existing multiple memberships retain IDs and require an authenticated authorised choice", async () => {
 const renamed = await mutate(a, "/institutions/current", { displayName: "Alpha Renamed Campus" }, "patch"); assert.equal(renamed.status, 200); assert.equal(renamed.body.data._id, a.id);
 const realm = await directory.realm(b.id), account = await directory.Account.findById(a.user._id).select("+passwordHash").lean(); await directory.addMember(realm, account, { role: "viewer" });
 const pending = await login(a.email); assert.equal(pending.response.status, 200); assert.equal(pending.response.body.data.selectionRequired, true);
 assert.deepEqual(new Set(pending.response.body.data.workspaces.map(w => w._id)), new Set([a.id, b.id])); assert.equal((await pending.account.agent.get("/api/v1/rooms")).status, 401);
 assert.equal((await mutate(pending.account, "/auth/select-workspace", { institutionId: "foreign-building" })).status, 403);
 const chosen = await login(a.email, b.id); assert.equal(chosen.response.body.data.user.role, "viewer"); assert.equal((await mutate(chosen.account, "/rooms", { code: "V", name: "Forbidden", roomBreakerId: "V" })).status, 403);
 assert.equal(await directory.Account.countDocuments({ email: a.email }), 1);
});

test("scoped camera/ingestion capabilities and sessions cannot change another institution", async () => {
  const realmA = await directory.realm(a.id), realmB = await directory.realm(b.id);
  for (const realm of [realmA, realmB]) await realm.models.Integration.create({ _id: "shared-camera", type: "camera", roomId: "shared-room-id", coverageValidated: true });
  const credential = createHmac("sha256", config.ingestToken).update(`${a.id}:shared-camera`).digest("hex");
  const payload = { eventId: "scoped-event", sourceId: "shared-camera", roomId: "shared-room-id", capturedAt: new Date().toISOString(), sourceType: "camera", occupancy: "occupied", detectedPeople: 1, confidence: 1, coverageValidated: true, quality: { usable: true }, dataMode: "simulated", modelVersion: "isolation-test" };
  const send = institutionId => request(runtime.app).post("/api/v1/ingest/observations").set("X-Institution-Id", institutionId).set("X-Source-Id", "shared-camera").set("Authorization", `Bearer ${credential}`).send(payload);
  assert.equal((await send(a.id)).status, 202); assert.equal((await send(b.id)).status, 401);
  assert.equal(await realmB.models.Observation.countDocuments(), 0);
  const session = await mutate(a, "/demo/sessions", { roomId: "shared-room-id", visionMode: "scenario_injection", coverageReviewed: true }); assert.equal(session.status, 201, JSON.stringify(session.body));
  const pair = await mutate(a, `/demo/sessions/${session.body.data._id}/pairing`, { role: "classroom" }); assert.equal(pair.status, 200);
  const paired = await request(runtime.app).post("/api/v1/demo-phone/pair").set("Origin", origin).send({ code: pair.body.data.code }); assert.equal(paired.status, 200);
  const token = paired.body.data.token;
  const state = await request(runtime.app).get("/api/v1/demo-phone/state").set("Authorization", `Bearer ${token}`); assert.equal(state.body.data.session.institutionId, a.id);
  const forged = `${b.id}.${token.split(".")[1]}`;
  assert.equal((await request(runtime.app).get("/api/v1/demo-phone/state").set("Authorization", `Bearer ${forged}`)).status, 401);
  const phone = socketClient(`http://127.0.0.1:${port}/demo-phone`, { forceNew: true, auth: { token }, transports: ["websocket"], extraHeaders: { Origin: origin }, reconnection: false });
  const rejectedPhone = socketClient(`http://127.0.0.1:${port}/demo-phone`, { forceNew: true, auth: { token: forged }, transports: ["websocket"], extraHeaders: { Origin: origin }, reconnection: false });
  try {
    const [reported] = await Promise.all([
      new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Phone state timed out")), 4000); phone.once("demo:state", state => { clearTimeout(timer); resolve(state); }); phone.once("connect_error", reject); }),
      new Promise((resolve, reject) => { rejectedPhone.once("connect_error", resolve); rejectedPhone.once("connect", () => reject(new Error("Foreign phone capability accepted"))); }),
    ]);
    assert.equal(reported.session.institutionId, a.id);
    assert.ok([...runtime.io.of("/demo-phone").sockets.values()].some(socket => socket.rooms.has(`demo:${a.id}:${session.body.data._id}:classroom`)));
  } finally { phone.disconnect(); rejectedPhone.disconnect(); }
  assert.equal((await mutate(b, `/demo/sessions/${session.body.data._id}/stop`)).status, 404);
  await mutate(a, `/demo/sessions/${session.body.data._id}/stop`);
});

test("Viewer code resolves stable building identity and cannot grant administrator privileges", async () => {
 await mutate(a, "/institutions/current/join-code", { joinCode: "Alpha-Viewer-Join-2026" }, "put");
 const visitor = await guest(), joined = await mutate(visitor, "/auth/register", { name: "Viewer", email: "new-viewer@workspace.test", password, confirmPassword: password, accountType: "viewer", joinCode: "Alpha-Viewer-Join-2026" });
 assert.equal(joined.status, 201); assert.equal(joined.body.data.user.role, "viewer"); assert.equal(joined.body.data.user.institutionId, a.id); assert.equal(joined.body.data.institution.displayName, "Alpha Renamed Campus"); visitor.csrf = joined.body.data.csrfToken;
 assert.equal((await visitor.agent.get("/api/v1/management/building")).status, 403); assert.equal((await mutate(visitor, "/institutions/current/join-code", { joinCode: "Forbidden-Change-2026" }, "put")).status, 403);
 assert.equal((await login("new-viewer@workspace.test")).response.body.data.user.role, "viewer");
});

test("persistent jobs process only their workspace, including same deterministic IDs", async () => {
  const now = new Date();
  for (const account of [a, b]) {
    const realm = await directory.realm(account.id);
    await realm.models.Room.updateOne({ _id: "shared-room-id" }, { $set: { coverageValidated: true, cameraConfiguration: "installed", requiredSourceIds: ["shared-camera"], policyVersion: 10 } });
    await realm.models.Integration.updateOne({ _id: "shared-camera" }, { $set: { health: "online", freshnessSeconds: 30, coverageValidated: true } });
    await realm.models.Observation.deleteMany({});
    for (const offset of [-20000, -10000, 0]) await realm.models.Observation.create({ eventId: `vacancy-${offset}`, sourceId: "shared-camera", roomId: "shared-room-id", capturedAt: new Date(+now + offset), occupancy: "vacant", confidence: 1, coverageValidated: true, quality: { usable: true }, dataMode: "simulated" });
    await realm.models.Incident.create({ _id: "shared-incident", issueKey: "vacancy:shared-room-id", roomId: "shared-room-id", type: "vacancy", active: true, state: "open", openedAt: now, policyVersion: 10, firstResponderId: account.user._id });
    await realm.models.Job.create({ _id: "shared-job", incidentId: "shared-incident", roomId: "shared-room-id", stage: "first", dueAt: now, policyVersion: 10 });
  }
  const realmA = await directory.realm(a.id), realmB = await directory.realm(b.id);
  // Alpha's worker delivers only Alpha's alert; Beta's identical job stays pending.
  await directory.run(realmA, () => tick(realmA.models, config, now, "alpha-worker"));
  assert.notEqual((await realmA.models.Job.findById("shared-job").lean()).status, "pending");
  assert.equal((await realmB.models.Job.findById("shared-job").lean()).status, "pending");
  assert.equal(await realmB.models.Notification.countDocuments(), 0);
  assert.ok(await realmA.models.Notification.exists({ recipientId: a.user._id }));
});

test("socket membership and room subscriptions reject foreign rooms and invalid institution sessions", async () => {
  const logged = await login(b.email, b.id); assert.equal(logged.response.status, 200);
  const cookie = logged.response.headers["set-cookie"].map(value => value.split(";")[0]).join("; ");
  const socket = socketClient(`http://127.0.0.1:${port}`, { forceNew: true, transports: ["websocket"], extraHeaders: { Cookie: cookie, Origin: origin }, reconnection: false });
  try {
    await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
    const allowed = await new Promise(resolve => socket.emit("subscribe-room", "beta-only-room", resolve)); assert.equal(allowed.ok, true);
    const realmA = await directory.realm(a.id); await realmA.models.Room.create({ _id: "alpha-only-socket", code: "A3", name: "Alpha only", roomBreakerId: "a3" });
    const denied = await new Promise(resolve => socket.emit("subscribe-room", "alpha-only-socket", resolve)); assert.equal(denied.ok, false);
    const row = runtime.io.sockets.sockets.get(socket.id); assert.equal(row.data.institutionId, b.id);
    assert.ok([...row.rooms].every(room => !room.includes(a.id)));
  } finally { socket.disconnect(); }
});

test("explicit dedicated demo is isolated/idempotent, keeps password hashes and refuses account role resets", async () => {
  const demoConfig = { ...config, enableDemoSetup: true, demoAdminEmail: "showcase-admin@workspace.test", demoViewerEmail: "showcase-viewer@workspace.test", demoAdminPassword: randomBytes(24).toString("hex"), demoViewerPassword: randomBytes(24).toString("hex") };
  const first = await seedDedicatedDemo(directory, demoConfig), realm = await directory.realm(first.institutionId);
  const before = await realm.models.User.find().select("+passwordHash").sort({ role: 1 }).lean();
  assert.equal(before.length, 2); assert.equal(await realm.models.Room.countDocuments(), 3);
  const count = await realm.models.MeterReading.countDocuments();
  const second = await seedDedicatedDemo(directory, { ...demoConfig, demoAdminPassword: randomBytes(24).toString("hex") });
  assert.equal(second.institutionId, first.institutionId); assert.equal(await realm.models.MeterReading.countDocuments(), count);
  const after = await realm.models.User.find().select("+passwordHash").sort({ role: 1 }).lean();
  assert.ok(before.every((user, i) => user.passwordHash === after[i].passwordHash));
  assert.equal(await (await directory.realm(a.id)).models.MeterReading.countDocuments(), 0);
  await realm.models.User.updateOne({ role: "viewer" }, { $set: { active: false } });
  await assert.rejects(() => seedDedicatedDemo(directory, demoConfig), { code: "DEMO_IDENTITY_CONFLICT" });
  await assert.rejects(() => seedDedicatedDemo(directory, { ...demoConfig, env: "production" }), { code: "DEMO_SEED_DISABLED" });
});

test("legacy migration preserves IDs/roles/passwords, is explicit/idempotent and blocks ambiguous ownership", async () => {
  const { connection, models } = await connectDatabase(db.getUri("legacy_migration"));
  const dir = createInstitutionDirectory(connection, config); await dir.init();
  try {
    await models.Settings.create({ _id: "installation", installationName: "Original Campus" });
    const account = await directory.Account.findById(a.user._id).select("+passwordHash").lean();
    await models.User.create({ _id: "original-user", email: "legacy@workspace.test", name: "Unchanged", role: "hod", active: false, passwordHash: account.passwordHash });
    await models.Room.create({ _id: "original-room", code: "L1", name: "Original room", roomBreakerId: "original-master" });
    await assert.rejects(() => dir.assertMigrationReady(), { code: "WORKSPACE_MIGRATION_REQUIRED" });
    const dry = await migrateLegacyInstallation(dir); assert.equal(dry.dryRun, true); assert.equal(await dir.Institution.countDocuments(), 0);
    const applied = await migrateLegacyInstallation(dir, { apply: true }); assert.equal(applied.completed, true);
    const migrated = await models.User.findById("original-user").select("+passwordHash").lean(); assert.equal(migrated.role, "hod"); assert.equal(migrated.active, false); assert.ok(migrated.passwordHash === account.passwordHash);
    assert.equal(migrated.institutionId, applied.institutionId); assert.equal(await models.Room.countDocuments(), 1);
    const again = await migrateLegacyInstallation(dir, { apply: true }); assert.equal(again.alreadyComplete, true); assert.equal(await dir.Membership.countDocuments(), 1);
    await connection.collection("rooms").insertOne({ _id: "ambiguous", institutionId: "unknown-institution", code: "BAD", name: "Unmapped", roomBreakerId: "bad" });
    assert.ok((await migrateLegacyInstallation(dir)).conflicts.length > 0);
    await assert.rejects(() => migrateLegacyInstallation(dir, { apply: true }), { code: "MIGRATION_AMBIGUOUS" });
  } finally { await dir.close(); await connection.close(); }
});
