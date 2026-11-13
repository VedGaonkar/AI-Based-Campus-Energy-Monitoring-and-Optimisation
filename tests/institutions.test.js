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
const password = randomBytes(24).toString("base64url"), adminKey = randomInt(10000000, 100000000).toString();
const origin = "http://localhost:5000";
const mutate = (account, path, body = {}, method = "post") => account.agent[method](`/api/v1${path}`).set("Origin", origin).set("X-CSRF-Token", account.csrf).send(body);
async function guest() { const agent = request.agent(runtime.app); return { agent, csrf: (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken }; }
async function register(email, institutionName, discoverable) {
  const account = await guest();
  const response = await mutate(account, "/auth/register", { name: institutionName, email, password, adminKey, institutionName, discoverable });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { ...account, csrf: response.body.data.csrfToken, id: response.body.data.institution._id, user: response.body.data.user, email };
}
async function login(email, institutionId, key = adminKey, suppliedPassword = password) {
  const account = await guest(); const response = await mutate(account, "/auth/login", { email, password: suppliedPassword, ...(institutionId ? { institutionId } : {}), ...(key ? { adminKey: key } : {}) });
  return { account: { ...account, csrf: response.body.data?.csrfToken ?? account.csrf, id: institutionId }, response };
}
before(async () => {
  db = await startDatabase();
  config = loadConfig({ NODE_ENV: "test", MONGODB_URI: db.getUri("workspace_directory"), SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), ADMIN_INVITE_KEY: adminKey, PUBLIC_APP_URL: origin, FRONTEND_ORIGIN: origin });
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

test("public suggestions are minimal, bounded, escaped, discoverability-aware and private code grants no membership", async () => {
  const suggestions = await request(runtime.app).get("/api/v1/institutions/suggestions?q=Ins");
  assert.equal(suggestions.status, 200); assert.deepEqual(suggestions.body.data, [{ _id: a.id, displayName: "Alpha Institute" }]);
  assert.deepEqual((await request(runtime.app).get("/api/v1/institutions/suggestions?q=Al")).body.data, []);
  assert.deepEqual((await request(runtime.app).get("/api/v1/institutions/suggestions?q=%5B")).body.data, []);
  assert.deepEqual((await request(runtime.app).get("/api/v1/institutions/suggestions?q=Al%5B")).body.data, []);
  const code = await mutate(b, "/institutions/current/access-code"); assert.equal(code.status, 200);
  const visitor = await guest(), resolved = await mutate(visitor, "/institutions/resolve", { code: code.body.data.code });
  assert.deepEqual(resolved.body.data, { _id: b.id, displayName: "Beta Private Institute" });
  const wrongMember = await login(a.email, b.id); assert.equal(wrongMember.response.status, 401);
  assert.equal((await mutate(visitor, "/auth/login", { email: a.email, password, adminKey, workspaceCode: code.body.data.code })).status, 401);
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

test("rename and membership retain stable IDs; invited multi-membership account must choose authorised workspace", async () => {
  const renamed = await mutate(a, "/institutions/current", { displayName: "Alpha Renamed Campus", discoverable: true }, "patch"); assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data._id, a.id);
  assert.equal((await a.agent.get("/api/v1/settings")).body.data.installationName, "Alpha Renamed Campus");
  assert.equal((await login(a.email, a.id)).response.status, 200);
  const invitation = await mutate(b, "/institutions/current/invitations", { email: a.email, role: "viewer", expiresInHours: 1 }); assert.equal(invitation.status, 201);
  const guestAccount = await guest();
  const accepted = await mutate(guestAccount, "/auth/accept-invitation", { email: a.email, password, invitationToken: invitation.body.data.token }); assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.user._id, a.user._id); assert.equal(accepted.body.data.user.role, "viewer");
  assert.equal((await mutate(guestAccount, "/auth/accept-invitation", { email: a.email, password, invitationToken: invitation.body.data.token })).status, 403);
  const chosen = await login(a.email, b.id, null); assert.equal(chosen.response.status, 200); assert.equal(chosen.response.body.data.user.role, "viewer");
  assert.equal((await mutate(chosen.account, "/rooms", { code: "V", name: "Forbidden", roomBreakerId: "V" })).status, 403);
  assert.equal((await login(a.email, null)).response.status, 409);
  assert.equal(await directory.Account.countDocuments({ email: a.email }), 1);
  const duplicate = await registerDuplicate(); assert.equal(duplicate.status, 409);
  async function registerDuplicate() { const g = await guest(); return mutate(g, "/auth/register", { email: a.email, name: "Duplicate", password, adminKey, institutionName: "Another" }); }
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

test("invitations enforce email, expiry, exact role/scope and cannot be replaced by knowing an institution name/key", async () => {
  const guestAccount = await guest();
  const noInvite = await mutate(guestAccount, "/auth/register", { name: "Outsider", email: "outsider@workspace.test", password, institutionName: "Alpha Renamed Campus" });
  assert.equal(noInvite.status, 403);
  const invite = await mutate(a, "/institutions/current/invitations", { email: "new-viewer@workspace.test", role: "viewer", permittedRoomIds: ["shared-room-id"], expiresInHours: 1 }); assert.equal(invite.status, 201);
  const badEmail = await mutate(guestAccount, "/auth/register", { name: "Wrong email", email: "wrong-viewer@workspace.test", password, invitationToken: invite.body.data.token }); assert.equal(badEmail.status, 403);
  assert.equal(await directory.Account.countDocuments({ email: "wrong-viewer@workspace.test" }), 0);
  const joined = await mutate(guestAccount, "/auth/register", { name: "Invited viewer", email: "new-viewer@workspace.test", password, invitationToken: invite.body.data.token }); assert.equal(joined.status, 201);
  assert.equal(joined.body.data.user.institutionId, a.id); assert.equal(joined.body.data.user.role, "viewer"); assert.deepEqual(joined.body.data.user.permittedRoomIds, ["shared-room-id"]);
  assert.equal((await login("new-viewer@workspace.test", a.id)).response.status, 403);
  assert.equal((await login("new-viewer@workspace.test", a.id, "")).response.body.data.user.role, "viewer");
  const viewer = { ...guestAccount, csrf: joined.body.data.csrfToken };
  assert.equal((await viewer.agent.get("/api/v1/settings")).body.data.installationName, "Alpha Renamed Campus");
  assert.equal((await mutate(viewer, "/institutions/current", { displayName: "Unauthorised" }, "patch")).status, 403);
  const adminInvite = await mutate(a, "/institutions/current/invitations", { email: "invited-admin@workspace.test", role: "admin", expiresInHours: 1 });
  const adminGuest = await guest();
  assert.equal((await mutate(adminGuest, "/auth/register", { name: "Invited administrator", email: "invited-admin@workspace.test", password, invitationToken: adminInvite.body.data.token })).status, 403);
  assert.equal(await directory.Account.countDocuments({ email: "invited-admin@workspace.test" }), 0);
  assert.equal((await mutate(adminGuest, "/auth/register", { name: "Invited administrator", email: "invited-admin@workspace.test", password, invitationToken: adminInvite.body.data.token, adminKey })).status, 201);
  const expiry = await mutate(a, "/institutions/current/invitations", { role: "viewer", expiresInHours: 1 });
  await directory.Invitation.updateOne({ _id: expiry.body.data._id }, { $set: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal((await mutate(await guest(), "/auth/register", { name: "Expired", email: "expired@workspace.test", password, invitationToken: expiry.body.data.token })).status, 403);
  assert.equal((await mutate(a, "/institutions/current/invitations", { role: "viewer", permittedRoomIds: ["beta-only-room"] })).status, 400);
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
