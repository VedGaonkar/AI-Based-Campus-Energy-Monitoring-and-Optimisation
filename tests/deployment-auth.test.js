import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import { io } from "socket.io-client";
import { startDatabase } from "../scripts/database.mjs";
import { loadConfig, readServerEnvironment } from "../backend/src/config.js";
import { createInstitutionApplication } from "../backend/src/workspaces/runtime.js";
import { seedDedicatedDemo } from "../backend/src/workspaces/demo-seed.js";
import { issueSyncTicket, verifySyncTicket } from "../backend/src/realtime/tickets.js";
const env = () => ({ NODE_ENV: "production", SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), MONGODB_URI: "mongodb+srv://example.invalid/campus", FRONTEND_ORIGIN: "https://campus.example.org", PUBLIC_APP_URL: "https://api.example.org" });

test("production startup requires infrastructure, not optional demo provisioning credentials or SMTP", () => {
  const values = env();
  const config = loadConfig(values); assert.equal(config.host, "0.0.0.0"); assert.equal(config.port, 5000);
  assert.equal(loadConfig({ ...values, PORT: "10000" }).port, 10000);
  for (const password of ["", "six123", "eight123"]) assert.doesNotThrow(() => loadConfig({ ...values, DEMO_ADMIN_PASSWORD: password, DEMO_VIEWER_PASSWORD: password }));
  for (const key of ["MONGODB_URI", "SESSION_SECRET", "SERVICE_INGEST_TOKEN"]) {
    const missing = { ...values }; delete missing[key]; assert.throws(() => loadConfig(missing), new RegExp(key));
  }
  for (const key of ["SESSION_SECRET", "SERVICE_INGEST_TOKEN"]) {
    assert.throws(() => loadConfig({ ...values, [key]: "sensitive-short-value" }), error => error.message.includes(key) && !error.message.includes("sensitive-short-value"));
  }
  assert.deepEqual(readServerEnvironment({ NODE_ENV: "production" }, "not-read.env"), { NODE_ENV: "production" });
});
test("sync tickets expire, reject tampering and wrong secrets, and carry no password or role", () => {
  const secret = randomBytes(32).toString("hex"), ticket = issueSyncTicket(secret, "stored-session", 1000);
  assert.equal(verifySyncTicket(secret, ticket, 1001), "stored-session");
  assert.throws(() => verifySyncTicket(secret, ticket, 61000));
  assert.throws(() => verifySyncTicket("other-secret", ticket, 1001));
  assert.throws(() => verifySyncTicket(secret, `${ticket}x`, 1001));
  assert.throws(() => verifySyncTicket(secret, null));
  const payload = JSON.parse(Buffer.from(ticket.split(".")[0], "base64url")); assert.deepEqual(Object.keys(payload).sort(), ["expires", "purpose", "sid"]);
});
test("persisted six/eight character accounts, guarded seed, cookie-free live sync and restart persistence", async () => {
  const db = await startDatabase(); let runtime, socket;
  const adminPassword = randomBytes(6).toString("hex").slice(0, 6), viewerPassword = randomBytes(8).toString("hex").slice(0, 8);
  const values = { ...env(), NODE_ENV: "test", MONGODB_URI: db.getUri("deployment_auth"), ENABLE_DEMO_SETUP: "true", DEMO_ADMIN_EMAIL: "admin@deployment.test", DEMO_ADMIN_PASSWORD: adminPassword, DEMO_VIEWER_EMAIL: "viewer@deployment.test", DEMO_VIEWER_PASSWORD: viewerPassword };
  const config = loadConfig(values), origin = config.frontendOrigin;
  const write = (agent, csrf, path, body = {}) => agent.post(`/api/v1${path}`).set("Origin", origin).set("X-CSRF-Token", csrf).send(body);
  async function login(email, password) {
    const agent = request.agent(runtime.app), csrf = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
    const response = await write(agent, csrf, "/auth/login", { email, password });
    return { agent, response, csrf: response.body.data?.csrfToken };
  }
  try {
    runtime = await createInstitutionApplication(config);
    assert.equal(await runtime.directory.Account.countDocuments(), 0, "Startup must not seed");
    await assert.rejects(() => seedDedicatedDemo(runtime.directory, { ...config, enableDemoSetup: false }), { code: "DEMO_SEED_DISABLED" });
    await assert.rejects(() => seedDedicatedDemo(runtime.directory, { ...config, env: "production" }), { code: "DEMO_SEED_DISABLED" });
    await assert.rejects(() => seedDedicatedDemo(runtime.directory, { ...config, env: "production", allowProductionDemoSeed: true }), { code: "DEMO_CREDENTIALS_REQUIRED" });
    const seeded = await seedDedicatedDemo(runtime.directory, config);
    const accounts = await runtime.directory.Account.find().select("+passwordHash").sort({ email: 1 }).lean();
    const memberships = await runtime.directory.Membership.countDocuments();
    const realm = await runtime.directory.realm(seeded.institutionId);
    const roomCount = await realm.models.Room.countDocuments(), readingCount = await realm.models.MeterReading.countDocuments();
    assert.equal(accounts.length, 2); assert.equal(memberships, 2);
    assert.ok(await bcrypt.compare(adminPassword, accounts[0].passwordHash)); assert.ok(await bcrypt.compare(viewerPassword, accounts[1].passwordHash));
    await seedDedicatedDemo(runtime.directory, { ...config, env: "production", allowProductionDemoSeed: true, demoAdminPassword: randomBytes(24).toString("hex"), demoViewerPassword: randomBytes(24).toString("hex") });
    const again = await runtime.directory.Account.find().select("+passwordHash").sort({ email: 1 }).lean();
    assert.deepEqual(again.map(a => [a._id, a.passwordHash]), accounts.map(a => [a._id, a.passwordHash]));
    assert.equal(await runtime.directory.Membership.countDocuments(), memberships);
    let admin = await login(values.DEMO_ADMIN_EMAIL, adminPassword), viewer = await login(values.DEMO_VIEWER_EMAIL, viewerPassword);
    assert.equal(admin.response.status, 200); assert.equal(admin.response.body.data.user.role, "admin");
    assert.equal(viewer.response.status, 200); assert.equal(viewer.response.body.data.user.role, "viewer");
    assert.equal((await login(values.DEMO_ADMIN_EMAIL, "wrong-password")).response.status, 401);
    assert.equal((await write(viewer.agent, viewer.csrf, "/rooms", {})).status, 403);
    await new Promise(resolve => runtime.server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${runtime.server.address().port}`;
    const ticketResponse = await admin.agent.get("/api/v1/sync/ticket"); assert.equal(ticketResponse.headers["cache-control"], "no-store");
    socket = io(url, { autoConnect: false, transports: ["websocket"], extraHeaders: { Origin: origin }, auth: ticketResponse.body.data, reconnection: false });
    await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Sync ticket connection timeout")), 5000); socket.once("connect", () => { clearTimeout(timer); resolve(); }); socket.once("connect_error", error => { clearTimeout(timer); reject(error); }); socket.connect(); });
    const serverSocket = [...runtime.io.sockets.sockets.values()][0]; assert.equal(serverSocket.data.institutionId, seeded.institutionId); assert.equal(serverSocket.request.session.userId, undefined, "Cross-origin socket must authenticate without cookies");
    const disconnected = new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Logout did not revoke socket")), 5000); socket.once("disconnect", () => { clearTimeout(timer); resolve(); }); });
    assert.equal((await write(admin.agent, admin.csrf, "/auth/logout")).status, 200); await disconnected;
    assert.equal((await admin.agent.get("/api/v1/sync/ticket")).status, 401);
    await runtime.close(); runtime = await createInstitutionApplication(loadConfig({ ...values, ENABLE_DEMO_SETUP: "false", DEMO_ADMIN_PASSWORD: "unused", DEMO_VIEWER_PASSWORD: "unused" }));
    assert.equal((await login(values.DEMO_ADMIN_EMAIL, adminPassword)).response.status, 200); assert.equal((await login(values.DEMO_VIEWER_EMAIL, viewerPassword)).response.status, 200);
    const afterRestart = await runtime.directory.Account.find().select("+passwordHash").sort({ email: 1 }).lean();
    assert.deepEqual(afterRestart.map(a => [a._id, a.passwordHash]), accounts.map(a => [a._id, a.passwordHash]));
    assert.equal(await runtime.directory.Membership.countDocuments(), memberships);
    const restoredRealm = await runtime.directory.realm(seeded.institutionId);
    assert.equal(await restoredRealm.models.Room.countDocuments(), roomCount); assert.equal(await restoredRealm.models.MeterReading.countDocuments(), readingCount);
    assert.equal((await request(runtime.app).get("/api/v1/auth/me").set("Cookie", viewer.response.headers["set-cookie"][0].split(";")[0])).status, 200, "Stored session survives API restart");
  } finally { socket?.disconnect(); await runtime?.close(); await db.stop(); }
});
