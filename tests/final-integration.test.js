import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import request from "supertest";
import { io } from "socket.io-client";
import { deploymentOrigin } from "../shared/deployment-origins.js";
import { buildDemoApps } from "../scripts/build-demo-apps.mjs";
import { loadConfig } from "../backend/src/config.js";
import { startDatabase } from "../scripts/database.mjs";
import { createInstitutionApplication } from "../backend/src/workspaces/runtime.js";
const frontend = "https://app.campus.test", backend = "https://api.campus.test", phone = "https://camera.campus.test", classroom = "https://classroom.campus.test";
const password = randomBytes(20).toString("hex"), adminKey = randomBytes(20).toString("hex");
const environment = () => ({ NODE_ENV: "test", FRONTEND_ORIGIN: frontend, PUBLIC_APP_URL: backend, DEMO_PHONE_ORIGINS: `${phone},${classroom}`, DEMO_CAMERA_APP_URL: `${phone}/`, DEMO_CLASSROOM_APP_URL: `${classroom}/`, SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), ADMIN_INVITE_KEY: adminKey });
test("production origins fail closed; phone pairing URLs must match exact allowlisted secure deployments", () => {
  for (const value of ["https://*.example.org", "http://energy.example.org", "https://localhost", "https://127.0.0.1", "https://user:password@example.org", "https://example.org/path", "https://example.org?x=1"]) assert.throws(() => deploymentOrigin(value, { production: true }));
  const config = loadConfig({ ...environment(), NODE_ENV: "production", HOST: "0.0.0.0", DEMO_TIME_SCALE: "1" }); assert.equal(config.host, "0.0.0.0"); assert.equal(config.demoCameraAppUrl, `${phone}/`);
  assert.throws(() => loadConfig({ ...environment(), DEMO_CAMERA_APP_URL: "https://foreign.example.org/" }), /listed/);
  assert.throws(() => loadConfig({ ...environment(), NODE_ENV: "production", DEMO_PHONE_ORIGINS: "http://localhost:5174" }), /HTTPS/);
});
test("camera and classroom build independently with local assets and explicit public API/realtime origins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "campus-build-"));
  try {
    for (const role of ["camera", "classroom"]) await buildDemoApps({ role, outputRoot: dir, apiOrigin: backend, realtimeOrigin: backend });
    for (const artifact of ["phone-camera", "virtual-classroom"]) {
      const html = await readFile(join(dir, artifact, "index.html"), "utf8"), code = await readFile(join(dir, artifact, "shared/config.js"), "utf8");
      assert.ok(html.includes('./shared/socket.io.js')); assert.ok(!html.includes('src="/socket.io/')); assert.ok(code.includes(backend)); assert.ok(!code.includes("localhost"));
      assert.ok((await readFile(join(dir, artifact, "main.js"), "utf8")).includes('./shared/')); assert.ok((await readFile(join(dir, artifact, "shared/socket.io.js"))).length > 1000);
    }
    await assert.rejects(() => buildDemoApps({ role: "camera", outputRoot: dir, apiOrigin: "http://localhost:5000" }), /HTTPS/);
  } finally { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); await rm(dir, { recursive: true, force: true }); }
});
test("production proxy mode issues secure Strict cookies and explicit HTTPS/WSS/frame ancestry headers", async () => {
  const prod = await createInstitutionApplication(loadConfig({ ...environment(), NODE_ENV: "production", DEMO_MODE: "false", DEMO_TIME_SCALE: "1", MONGODB_URI: db.getUri("production_header_check") }));
  try {
    const r = await request(prod.app).get("/api/v1/auth/session").set("Origin", frontend).set("X-Forwarded-Proto", "https");
    assert.equal(r.status, 200); assert.equal(r.headers["access-control-allow-origin"], frontend);
    assert.match(r.headers["set-cookie"][0], /Secure/); assert.match(r.headers["set-cookie"][0], /HttpOnly/); assert.match(r.headers["set-cookie"][0], /SameSite=Strict/);
    assert.match(r.headers["content-security-policy"], /wss:\/\/api\.campus\.test/); assert.match(r.headers["content-security-policy"], /frame-ancestors 'self' https:\/\/app\.campus\.test/);
    assert.equal((await request(prod.app).get("/presenter").set("Accept", "text/html")).status, 200);
  } finally { await prod.close(); }
});
let db, runtime, a, b, viewer, models, room, base;
const sockets = [];
const write = (member, path, body = {}, method = "post") => member.agent[method](path.startsWith("/assistant") ? path : `/api/v1${path}`).set("Origin", frontend).set("X-CSRF-Token", member.csrf).send(body);
async function register(name, accountType = "administrator") {
  const agent = request.agent(runtime.app), csrf = (await agent.get("/api/v1/auth/csrf").set("Origin", frontend)).body.data.csrfToken;
  const common = { name, email: `${name}@milestone.test`, password, confirmPassword: password, accountType, joinCode: accountType === "administrator" ? `${name}-Building-2026` : "alpha-Building-2026" };
  const result = await write({ agent, csrf }, "/auth/register", accountType === "administrator" ? { ...common, institutionName: name, adminKey } : common);
  assert.equal(result.status, 201, JSON.stringify(result.body.error)); return { agent, csrf: result.body.data.csrfToken, user: result.body.data.user, id: result.body.data.institution._id, cookie: result.headers["set-cookie"][0].split(";")[0] };
}
async function good(member, path, body, method) { const r = await write(member, path, body, method); assert.ok(r.status < 300, `${path} ${r.status}: ${JSON.stringify(r.body.error)}`); return r.body.data; }
const until = async fn => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 60)); } throw new Error("Cross-feature live update timed out"); };
before(async () => {
  db = await startDatabase(); runtime = await createInstitutionApplication(loadConfig({ ...environment(), DEMO_MODE: "false", DEMO_TIME_SCALE: "1", MONGODB_URI: db.getUri("final_milestone") })); await new Promise(r => runtime.server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${runtime.server.address().port}`;
  a = await register("alpha"); b = await register("beta"); viewer = await register("reader", "viewer"); models = (await runtime.directory.realm(a.id)).models;
});
after(async () => { sockets.forEach(s => s.disconnect()); await runtime?.close(); await db?.stop(); });
test("new institution stays empty; cross-origin sessions retain CSRF, exact origins and Viewer isolation", async () => {
  assert.equal((await a.agent.get("/api/v1/rooms").set("Origin", frontend)).headers["access-control-allow-origin"], frontend);
  for (const member of [a, b]) for (const path of ["rooms", "devices", "meter-readings", "incidents"]) assert.deepEqual((await member.agent.get(`/api/v1/${path}`)).body.data, []);
  assert.equal(viewer.id, a.id);
  const preflight = await request(runtime.app).options("/api/v1/auth/login").set("Origin", frontend).set("Access-Control-Request-Method", "POST").set("Access-Control-Request-Headers", "content-type,x-csrf-token"); assert.equal(preflight.status, 204); assert.equal(preflight.headers["access-control-allow-credentials"], "true");
  assert.equal((await request(runtime.app).get("/api/v1/auth/session").set("Origin", "https://foreign.test")).status, 403);
  assert.equal((await request(runtime.app).get("/assets/missing-release.js")).status, 404);
  assert.equal((await request(runtime.app).get("/demo/missing-app/main.js")).status, 404);
  assert.equal((await request(runtime.app).get("/presenter").set("Accept", "text/html")).status, 200);
  assert.equal((await a.agent.get("/api/v1/auth/session").set("Origin", phone)).status, 403);
  assert.equal((await request(runtime.app).options("/api/v1/demo-phone/pair").set("Origin", phone)).status, 204);
  assert.equal((await request(runtime.app).options("/api/v1/demo-phone/pair").set("Origin", "https://camera.campus.test.evil.org")).status, 403);
  assert.equal((await a.agent.post("/api/v1/rooms").set("Origin", frontend).send({})).status, 403);
  const guest = request.agent(runtime.app), csrf = (await guest.get("/api/v1/auth/csrf")).body.data.csrfToken;
  const failed = await write({ agent: guest, csrf }, "/auth/register", { name: "Denied", email: "denied@milestone.test", password, confirmPassword: password, accountType: "administrator", institutionName: "Denied", joinCode: "Denied-Building-2026", adminKey: "incorrect" }); assert.equal(failed.status, 403); assert.equal(await runtime.directory.Account.countDocuments({ email: "denied@milestone.test" }), 0);
});
test("room/device registration is independent of presenter; rename and authorised action reach active scoped sessions", async () => {
  room = await good(a, "/rooms", { code: "M1", name: "Milestone room", roomBreakerId: "MASTER-M1" });
  const device = await good(a, "/devices", { roomId: room._id, name: "Ordinary light", category: "lighting", ratedWatts: 20 }); assert.equal(device.controlledByRoomBreakerId, room.roomBreakerId);
  assert.equal((await write(a, "/management/cameras", { name: "Not a feed", roomId: room._id, connectionMethod: "gateway", url: "https://example.org/" })).status, 400);
  await good(a, `/users/${viewer.user._id}`, { permittedRoomIds: [room._id] }, "patch");
  assert.equal((await b.agent.get(`/api/v1/rooms/${room._id}`)).status, 404);
  assert.equal((await write(viewer, `/rooms/${room._id}`, { name: "Forbidden" }, "patch")).status, 403);
  const socket = io(base, { forceNew: true, transports: ["websocket"], extraHeaders: { Cookie: viewer.cookie, Origin: frontend }, reconnection: false }); sockets.push(socket);
  const events = []; socket.on("sync:change", e => events.push(e)); let ready = false; socket.on("sync:reset", () => { ready = true; });
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); }); await until(() => ready);
  await good(a, "/institutions/current", { displayName: "Renamed sustainability institute" }, "patch");
  await good(a, `/rooms/${room._id}`, { name: "Updated authorised room" }, "patch");
  await until(() => events.some(e => e.resource === "rooms"));
  assert.equal((await viewer.agent.get("/api/v1/settings")).body.data.installationName, "Renamed sustainability institute"); assert.equal((await a.agent.get("/api/v1/auth/me")).body.data.user.institution.displayName, "Renamed sustainability institute"); assert.equal((await viewer.agent.get(`/api/v1/rooms/${room._id}`)).body.data.name, "Updated authorised room");
});
test("embedded AI rereads changed website data and only applies permitted confirmed tasks", async () => {
  const first = await write(a, "/assistant/api/message", { message: "Show all rooms" }); assert.equal(first.status, 200); assert.match(JSON.stringify(first.body), /Updated authorised room/);
  await good(a, `/rooms/${room._id}`, { name: "Fresh room without cache delay" }, "patch");
  const fresh = await write(a, "/assistant/api/message", { message: "Show all rooms" }); assert.equal(fresh.status, 200); assert.match(JSON.stringify(fresh.body), /Fresh room without cache delay/);
  const proposal = await write(a, "/assistant/api/message", { message: "Send an alert to everyone that Integration evidence verified" }); assert.equal(proposal.status, 200); const id = proposal.body.reply.proposal.id;
  assert.ok(!JSON.stringify((await a.agent.get("/assistant/api/announcements")).body).includes("Integration evidence verified"));
  assert.equal((await write(viewer, "/assistant/api/confirm", { proposalId: id })).status, 403);
  assert.equal((await write(a, "/assistant/api/confirm", { proposalId: id })).status, 200);
  assert.ok(JSON.stringify((await viewer.agent.get("/assistant/api/announcements")).body).includes("Integration evidence verified")); assert.ok(!JSON.stringify((await b.agent.get("/assistant/api/announcements")).body).includes("Integration evidence verified"));
});
test("reviewed real OCR output updates intervals and ESG once; operational and simulated meter modes stay separate", async () => {
  const meterId = "INTEGRATED-METER"; await good(a, "/meters", { meterId, name: "Integration meter", maxPowerKw: 100 });
  const camera = await good(a, "/meter-cameras", { name: "Synthetic image test", meterId, dataMode: "simulated" });
  assert.equal((await write(a, "/meter-cameras", { name: "Website is not camera", meterId, url: "https://example.org/" })).status, 400);
  const end = new Date(Math.floor(Date.now() / 3600000) * 3600000 - 3600000), start = new Date(+end - 3600000);
  await good(a, "/meter-readings", { eventId: randomUUID(), meterId, capturedAt: start.toISOString(), value: 12344.42, sourceType: "manual", dataMode: "simulated" });
  const image = { mime: "image/png", image: (await readFile("fixtures/meter/synthetic-kwh.png")).toString("base64") };
  const frame = { captureId: randomUUID(), capturedAt: end.toISOString(), images: [image, image] };
  const capture = await good(a, `/meter-cameras/${camera._id}/test`, frame); assert.equal(capture.candidateKwh, 12345.67); assert.equal(capture.status, "needs_review"); assert.equal(await models.EnergyInterval.countDocuments({ meterId }), 0);
  await good(a, `/meter-captures/${capture._id}/review`, { action: "accept", reason: "Synthetic display, timestamp and kWh visually checked" });
  assert.equal((await good(a, `/meter-cameras/${camera._id}/test`, frame)).duplicate, true);
  const rows = (await a.agent.get("/api/v1/analytics/intervals")).body.data.filter(r => r.meterId === meterId); assert.equal(rows.length, 1); assert.equal(rows[0].energyKwh, 1.25); assert.equal(rows[0].averagePowerKw, 1.25);
  await good(a, "/sustainability/config", { enabled: true, reductionThreshold: 5, minimumCoverage: 90 }, "patch");
  const selection = { meterId, start: start.toISOString(), end: end.toISOString(), baselineStart: new Date(+start - 86400000).toISOString(), baselineEnd: new Date(+end - 86400000).toISOString(), dataMode: "simulated" };
  const report = await good(a, "/sustainability/preview", selection); assert.equal(report.current.kwh, 1.25); assert.equal(report.current.estimatedKgCO2, 1.25 * 0.675); assert.equal(report.recognition, null);
  assert.equal((await good(a, "/sustainability/preview", { ...selection, dataMode: "live" })).current.kwh, null);
  for (const [capturedAt, value] of [[start, 100], [end, 106]]) await good(a, "/meter-readings", { eventId: randomUUID(), meterId, capturedAt: capturedAt.toISOString(), value, sourceType: "manual", dataMode: "live" });
  assert.equal((await good(a, "/sustainability/preview", { ...selection, dataMode: "live" })).current.kwh, 6); assert.equal((await good(a, "/sustainability/preview", selection)).current.kwh, 1.25);
  assert.equal((await viewer.agent.get("/api/v1/settings")).body.data.installationName, "Renamed sustainability institute");
});
