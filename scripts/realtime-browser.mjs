// Independent Chrome profiles plus two real tabs. All data/credentials isolated.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import request from "supertest";
import { startDatabase } from "./database.mjs";
import { launchChrome } from "./chrome-driver.mjs";
import { loadConfig } from "../backend/src/config.js";
import { createInstitutionApplication } from "../backend/src/workspaces/runtime.js";
import { seedDedicatedDemo } from "../backend/src/workspaces/demo-seed.js";
import { getConnectedDeviceService } from "../backend/src/services/connected-devices.js";
const executable = process.env.BROWSER_EXECUTABLE ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!executable) throw new Error("Install Chrome/Edge or set BROWSER_EXECUTABLE");
let db, runtime; const browsers = [], pages = [], checks = [], errors = [];
const password = randomBytes(24).toString("base64url"), key = randomInt(10000000, 100000000).toString();
async function until(fn) { for (let i = 0; i < 150; i++) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); } throw new Error(`Browser condition timed out after ${checks.length} checks`); }
const text = page => page.evaluate(() => document.body.innerText);
async function pageFor(browser, base, email, institution, admin = false) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }); pages.push(page); page.on("pageerror", error => errors.push(error.message));
  await page.goto(base); await page.getByLabel("Institution / building").fill(institution);
  await page.locator(".institution-suggestions button").click(); await page.getByLabel("Email address").fill(email); await page.getByLabel("Password").fill(password);
  if (admin) await page.getByLabel("Admin invite key").fill(key);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await until(async () => (await text(page)).includes("Live updates connected")); return page;
}
try {
  const probe = createServer(); await new Promise(r => probe.listen(0, "127.0.0.1", r)); const port = probe.address().port; await new Promise(r => probe.close(r));
  const base = `http://localhost:${port}`;
  db = await startDatabase(); const config = loadConfig({ NODE_ENV: "test", MONGODB_URI: db.getUri("realtime_browser"), ADMIN_INVITE_KEY: key, SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), FRONTEND_ORIGIN: base, PUBLIC_APP_URL: base });
  runtime = await createInstitutionApplication(config);
  const seeded = await seedDedicatedDemo(runtime.directory, { ...config, enableDemoSetup: true, demoAdminEmail: "admin@sync.test", demoViewerEmail: "viewer@sync.test", demoAdminPassword: password, demoViewerPassword: password });
  const realm = await runtime.directory.realm(seeded.institutionId), models = realm.models;
  const beta = request.agent(runtime.app), betaCsrf = (await beta.get("/api/v1/auth/csrf")).body.data.csrfToken;
  assert.equal((await beta.post("/api/v1/auth/register").set("Origin", base).set("X-CSRF-Token", betaCsrf).send({ name: "Foreign admin", email: "foreign@sync.test", password, adminKey: key, institutionName: "Foreign Isolated Institute", discoverable: true })).status, 201);
  const agent = request.agent(runtime.app), csrf = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
  const logged = await agent.post("/api/v1/auth/login").set("Origin", base).set("X-CSRF-Token", csrf).send({ email: "admin@sync.test", password, adminKey: key, institutionId: seeded.institutionId }); assert.equal(logged.status, 200);
  const mutate = async (path, body, method = "post") => { const response = await agent[method](`/api/v1${path}`).set("Origin", base).set("X-CSRF-Token", logged.body.data.csrfToken).send(body); assert.ok(response.status < 300, `${path}: ${response.status} ${JSON.stringify(response.body.error)}`); return response.body.data; };
  await models.Schedule.deleteMany({ roomId: "room-r101" });
  await models.Integration.updateOne({ _id: "CAM-R101" }, { $set: { health: "online", coverageValidated: true, lastSeenAt: new Date(), freshnessSeconds: 300 } });
  await models.Room.updateOne({ _id: "room-r101" }, { $set: { nativeOffMode: "simulated", requiredSourceIds: ["CAM-R101"], coverageValidated: true, controlMode: "simulated" } });
  await models.Observation.create({ eventId: randomUUID(), sourceId: "CAM-R101", roomId: "room-r101", sourceType: "camera", capturedAt: new Date(Date.now() - 25000), receivedAt: new Date(), occupancy: "vacant", confidence: 1, coverageValidated: true, quality: { usable: true }, equipment: { anyOn: true }, dataMode: "simulated" });
  const connection = await mutate("/device-connections", { name: "Browser simulator", provider: "simulator" }); await mutate(`/device-connections/${connection._id}/test`, {});
  const device = await mutate("/connected-devices", { connectionId: connection._id, entityId: "light.demo_lecture", roomId: "room-r101" });
  await mutate(`/connected-devices/${device._id}/review`, { classification: "ordinary", identityReviewed: true, capabilityReviewed: true, manualOffAllowed: true, reviewNotes: "Isolated simulated ordinary target" }, "patch");
  await mutate(`/device-connections/${connection._id}/simulation`, { entityId: device.entityId, state: "on", outcome: "transport_error" });
  await new Promise(resolve => runtime.server.listen(port, "127.0.0.1", resolve));
  for (let i = 0; i < 3; i++) browsers.push(await launchChrome(executable));
  const administrator = await pageFor(browsers[0], base, "admin@sync.test", "Campus Energy Demo", true);
  const tab = await browsers[0].newTab({ viewport: { width: 1440, height: 1080 } }); pages.push(tab); tab.on("pageerror", error => errors.push(error.message));
  await tab.goto(`${base}/rooms?room=room-r101`);
  const viewer = await pageFor(browsers[1], base, "viewer@sync.test", "Campus Energy Demo");
  const foreign = await pageFor(browsers[2], base, "foreign@sync.test", "Foreign Isolated", true);
  await viewer.goto(`${base}/rooms?room=room-r101`); await administrator.goto(`${base}/rooms?room=room-r101`); await administrator.bringToFront();
  await until(async () => (await text(viewer)).toLowerCase().includes("simulated supply on"));
  assert.ok(!(await text(viewer)).includes("Supply OFF\nSupply ON"));
  await administrator.getByRole("button", { name: "Supply OFF" }).click();
  await until(async () => (await text(viewer)).toLowerCase().includes("simulated supply off"));
  await tab.bringToFront(); await until(async () => (await text(tab)).toLowerCase().includes("simulated supply off"));
  assert.ok(!(await text(foreign)).includes("Lecture Hall"));
  checks.push("Permitted simulator OFF updates independent viewer and second tab; foreign institution stays isolated");
  await administrator.bringToFront(); await administrator.getByRole("button", { name: "Supply ON" }).click();
  await until(async () => (await text(viewer)).toLowerCase().includes("simulated supply on"));
  await administrator.goto(`${base}/profile`); await administrator.getByLabel("Institution / building display name").fill("Renamed Live Campus");
  await administrator.getByRole("button", { name: "Save institution identity" }).click();
  await until(async () => (await text(viewer)).includes("Renamed Live Campus")); await tab.bringToFront(); await until(async () => (await text(tab)).includes("Renamed Live Campus"));
  assert.ok(!(await text(foreign)).includes("Renamed Live Campus")); checks.push("Institution rename reaches viewer and another page/tab without changing subscriptions");
  await administrator.goto(`${base}/connected-devices`); await administrator.bringToFront(); await viewer.goto(`${base}/connected-devices`);
  await administrator.getByRole("button", { name: "Device details & commands" }).click(); await viewer.getByRole("button", { name: "Device details & commands" }).click();
  await administrator.locator('input[aria-label="Confirm exact OFF target"]').check(); await administrator.getByRole("button", { name: "Request test OFF" }).click();
  await until(() => models.NativeCommand.exists({ deviceId: device._id, status: "requested" }));
  await until(async () => (await text(viewer)).includes("requested"));
  await getConnectedDeviceService(models, config).processJobs();
  await until(async () => (await text(viewer)).includes("TRANSPORT") && (await text(administrator)).includes("TRANSPORT"));
  assert.equal((await models.Breaker.findById("BRK-R101").lean()).reportedSupply, "on");
  assert.ok((await text(viewer)).includes("No matching OFF observation"));
  checks.push("Native OFF requested and failed outcome synchronise; no confirmed OFF or breaker fallback fabricated");
  await viewer.setOffline(true);
  // Close the existing transport too: network emulation blocks new handshakes,
  // but some Chromium versions retain an already-open WebSocket.
  for (const socket of runtime.io.sockets.sockets.values()) if (socket.data.user.role === "viewer") socket.conn.close();
  await until(async () => /Disconnected|Updates unavailable/.test(await text(viewer)));
  await models.Room.updateOne({ _id: "room-r101" }, { $set: { name: "Changed during network loss" } });
  await models.Notification.create({ roomId: "room-r101", recipientId: (await models.User.findOne({ role: "viewer" }).lean())._id, title: "One background notification", message: "Persisted once", state: "sent", idempotencyKey: randomUUID() });
  await viewer.setOffline(false); await viewer.bringToFront();
  await until(async () => (await text(viewer)).includes("Changed during network loss") && (await text(viewer)).includes("Live updates connected"));
  checks.push("Offline banner marks cached data stale; reconnect repairs missed room changes from backend snapshot");
  await viewer.getByRole("button", { name: "Close dialog" }).click(); await viewer.goto(`${base}/incidents`);
  await until(async () => (await text(viewer)).includes("One background notification"));
  assert.equal(await viewer.evaluate(() => [...document.querySelectorAll('.notification-row strong')].filter(row => row.textContent === 'One background notification').length), 1);
  checks.push("Background notification arrives once in authorised inbox");
  await tab.bringToFront();
  for (const [name, path] of [["Incidents", "/incidents"], ["Rooms", "/rooms"], ["Incidents", "/incidents"], ["Rooms", "/rooms"]]) {
    await tab.getByRole("link", { name }).click(); await until(() => tab.evaluate(path => location.pathname === path, path));
  }
  await until(() => [...runtime.io.sockets.sockets.values()].filter(socket => socket.data.institutionId === seeded.institutionId).length === 3);
  checks.push("Navigation retains one connection per tab/user without accumulating socket listeners");
  assert.deepEqual(errors, []); await mkdir(".local/screenshots", { recursive: true }); await viewer.screenshot({ path: ".local/screenshots/realtime-inbox.png", fullPage: true });
  await writeFile(".local/realtime-browser.json", JSON.stringify({ checks, runtimeErrors: errors, independentBrowserProfiles: 3, sharedProfileTabs: 2 }, null, 2));
  console.log(`${checks.length} real-time browser checks passed across 3 profiles and 2 shared-profile tabs; no runtime errors.`);
} catch (error) { await writeFile(".local/realtime-browser-failure.txt", (await Promise.all(pages.map(page => text(page).catch(() => "Closed")))) .join("\n--- PAGE ---\n")); if (runtime) await writeFile(".local/realtime-browser-sockets.json", JSON.stringify([...runtime.io.sockets.sockets.values()].map(socket => ({ role: socket.data.user.role, institutionId: socket.data.institutionId, transport: socket.conn.transport.name })), null, 2)); throw error; }
finally { for (const browser of browsers) await browser.close(); await runtime?.close(); await db?.stop(); }
