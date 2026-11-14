// Isolated end-to-end demonstration; never uses a saved gateway or user data.
import { createServer } from "node:net";
import { randomBytes, randomInt } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { startDatabase } from "./database.mjs";
import { launchChrome } from "./chrome-driver.mjs";
import { connectDatabase } from "../backend/src/models/index.js";
import { loadConfig } from "../backend/src/config.js";
import { createApplication } from "../backend/src/app.js";
import { seed } from "../backend/src/seed.js";
import { tick } from "../backend/src/workers/tick.js";
import { getConnectedDeviceService } from "../backend/src/services/connected-devices.js";
const executable = process.env.BROWSER_EXECUTABLE ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!executable) throw new Error("Set BROWSER_EXECUTABLE to an installed Chromium browser");
let db, connection, runtime, browser, page, models, running = true, worker, workerTicks = 0;
const password = randomBytes(18).toString("hex"), adminKey = randomInt(10000000, 100000000).toString(), checks = [], errors = [];
async function waitFor(operation, limit = 70000) {
  const end = Date.now() + limit;
  while (Date.now() < end) { const result = await operation(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 250)); }
  throw new Error("Timed out waiting for an isolated connected-device workflow");
}
try {
  const probe = createServer(); await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
  const base = `http://localhost:${port}`;
  db = await startDatabase(); ({ connection, models } = await connectDatabase(db.getUri("connected_browser")));
  const config = loadConfig({ NODE_ENV: "test", SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), DEMO_MODE: "true", DEMO_TIME_SCALE: "60", FRONTEND_ORIGIN: base, PUBLIC_APP_URL: base });
  await seed(models, config, { password });
  runtime = createApplication({ config, connection, models }); await new Promise((resolve, reject) => { runtime.server.once("error", reject); runtime.server.listen(port, "127.0.0.1", resolve); });
  worker = (async () => { while (running) { try { await tick(models, config); workerTicks++; } catch (error) { if (error.code !== "ROOM_BUSY") errors.push(`Worker: ${error.code ?? error.name}`); } await new Promise((resolve) => setTimeout(resolve, 250)); } })();
  await mkdir(".local/screenshots", { recursive: true });
  browser = await launchChrome(executable); page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base); await page.getByLabel("Email address").fill("admin@campus.test"); await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in to workspace" }).click(); await page.getByRole("heading", { name: "Your building. One control centre." }).waitFor();
  await page.goto(`${base}/connected-devices`); await page.getByRole("heading", { name: "Connected devices" }).waitFor();
  await page.getByRole("button", { name: "Add connection" }).click(); await page.getByLabel("Connection name").fill("Browser equipment simulator");
  await page.getByRole("button", { name: "Save device connection" }).click(); await page.getByRole("button", { name: "Test connection" }).waitFor();
  await page.getByRole("button", { name: "Test connection" }).click(); await waitFor(async () => (await models.DeviceConnection.findOne({ name: "Browser equipment simulator" }).lean())?.health === "online");
  checks.push("Simulator connection saved and tested through UI without physical requests");
  await page.getByRole("button", { name: "Discover" }).click(); await page.getByRole("button", { name: "Map to room" }).first().waitFor();
  assert.ok(await page.evaluate(() => document.body.innerText.includes("Read-only") && document.body.innerText.includes("switch.room_master")));
  await page.getByRole("button", { name: "Map to room" }).first().click(); await page.getByLabel("Campus room").selectOption("room-r101");
  await page.getByRole("button", { name: "Register mapped device" }).click(); await page.getByRole("button", { name: "Device details & commands" }).first().waitFor();
  const target = await models.ConnectedDevice.findOne({ entityId: "light.demo_lecture" }).lean(); assert.ok(target);
  await page.getByRole("button", { name: "Close discovery" }).click();
  await page.screenshot({ path: ".local/screenshots/connected-devices-desktop.png", fullPage: true });
  checks.push("Discovery shows compatibility reasons and binds exact entity to a campus room");
  await page.getByRole("button", { name: "Device details & commands" }).click();
  await page.getByLabel("Load classification").selectOption("ordinary");
  await page.locator('input[name="identityReviewed"]').check(); await page.locator('input[name="capabilityReviewed"]').check(); await page.locator('input[name="manualOffAllowed"]').check();
  await page.getByLabel("Capability & load review evidence").fill("Approved ordinary demonstration light; exact simulated entity and native OFF reviewed.");
  await page.getByRole("button", { name: "Save device review" }).click();
  await waitFor(async () => (await models.ConnectedDevice.findById(target._id).lean()).manualOffAllowed);
  await page.getByRole("button", { name: "Prepare simulated vacancy" }).click();
  await waitFor(async () => { const room = await models.Room.findById("room-r101").lean(); return room.demoScenario === "vacant" && room.nativeOffMode === "simulated"; });
  // The persistent worker must accumulate its configured vacancy confirmation.
  await waitFor(async () => { const response = await page.evaluate(async () => (await fetch("/api/v1/rooms/room-r101/status")).json()); return response.data?.observed.state === "vacant"; });
  // A concurrent worker may legitimately hold the room's policy lock. Retry
  // only its explicit pre-dispatch ROOM_BUSY response, never an uncertain command.
  for (let attempt = 0; attempt < 8; attempt++) {
    await page.getByRole("checkbox", { name: "Confirm exact OFF target" }).check(); await page.getByRole("button", { name: "Request test OFF" }).click();
    const outcome = await waitFor(async () => await models.NativeCommand.findOne({ deviceId: target._id, reason: "manual_test" }).lean() || await page.evaluate(() => document.body.innerText.includes("Room policy is changing; retry shortly")) && "retry", 12000);
    if (outcome !== "retry") break;
    if (attempt === 7) throw new Error("Room remained busy; no OFF command was dispatched");
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  await waitFor(() => models.NativeCommand.findOne({ deviceId: target._id, reason: "manual_test", status: "confirmed" }).lean(), 15000);
  await waitFor(async () => await page.evaluate(() => document.body.innerText.includes("Last test: confirmed")));
  checks.push("Capability review and explicit test OFF receive simulated reported-state confirmation");
  await page.getByRole("button", { name: "Enable automatic OFF" }).click();
  await waitFor(async () => (await models.ConnectedDevice.findById(target._id).lean()).automaticOffAllowed);
  await page.getByRole("button", { name: "Simulate ON / confirms OFF" }).click();
  const automatic = await waitFor(() => models.NativeCommand.findOne({ deviceId: target._id, reason: "vacancy_escalation", status: "confirmed" }).lean());
  await waitFor(() => page.evaluate(() => document.body.innerText.includes("State: off") && document.body.innerText.includes("vacancy escalation")));
  const incident = await models.Incident.findById(automatic.incidentId).lean();
  assert.ok(incident.timeline.some((item) => item.event === "second_notification")); assert.equal(await models.Command.countDocuments(), 0);
  checks.push("Persistent first alert/HOD escalation/final recheck produces native OFF without breaker fallback");
  console.log("Connected-device browser: confirmed escalation flow passed (simulated).");
  await page.screenshot({ path: ".local/screenshots/connected-device-confirmed.png", fullPage: true });
  // External/provider ON after successful automation suspends repeated OFF.
  await page.getByRole("button", { name: "Simulate ON / confirms OFF" }).click();
  await waitFor(async () => !(await models.ConnectedDevice.findById(target._id).lean()).automaticOffAllowed);
  await page.getByRole("button", { name: "Enable automatic OFF" }).waitFor(); await page.getByRole("button", { name: "Enable automatic OFF" }).click();
  const pendingIncident = await waitFor(() => models.Incident.findOne({ roomId: "room-r101", active: true, type: "vacancy" }).lean());
  await page.getByRole("button", { name: "Simulate person returns" }).click();
  await waitFor(async () => (await models.Incident.findById(pendingIncident._id).lean()).state === "cancelled");
  assert.equal(await models.NativeCommand.countDocuments({ incidentId: pendingIncident._id }), 0);
  checks.push("Provider-side ON suspends repeat automation; renewed occupancy cancels pending escalation");
  await page.getByRole("button", { name: "Simulate ON / no OFF feedback" }).click();
  await page.getByRole("button", { name: "Prepare simulated vacancy" }).click();
  const unverified = await waitFor(() => models.NativeCommand.findOne({ deviceId: target._id, reason: "vacancy_escalation", status: "unverified" }).lean());
  assert.equal((await models.Incident.findById(unverified.incidentId).lean()).state, "blocked"); assert.equal(await models.Command.countDocuments(), 0);
  checks.push("Accepted request without OFF feedback stays unverified; breaker remains untouched");
  console.log("Connected-device browser: unverified/no-fallback flow passed (simulated).");
  await page.getByRole("button", { name: "Simulate unavailable" }).click();
  await waitFor(async () => (await models.ConnectedDevice.findById(target._id).lean()).lastState.state === "unavailable");
  await page.getByRole("checkbox", { name: "Confirm exact OFF target" }).check(); await page.getByRole("button", { name: "Request test OFF" }).click();
  await waitFor(() => models.NativeCommand.findOne({ deviceId: target._id, reason: "manual_test", status: "failed", errorCode: "UNAVAILABLE" }).lean());
  assert.equal(await models.Command.countDocuments(), 0); checks.push("Unavailable device never becomes confirmed OFF and does not initiate room cutoff");
  await page.getByRole("button", { name: "Close dialog" }).click(); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/connected-devices`); await page.getByRole("button", { name: "Device details & commands" }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: ".local/screenshots/connected-devices-mobile.png", fullPage: true });
  checks.push("Connected Devices layout fits 390px viewport");
  await page.getByRole("button", { name: "Disconnect" }).click(); await page.getByRole("button", { name: "Disconnect this gateway" }).click();
  await waitFor(async () => !(await models.DeviceConnection.findById(target.connectionId).lean()).enabled && !(await models.ConnectedDevice.findById(target._id).lean()).automaticOffAllowed);
  assert.equal((await models.ConnectedDevice.findById(target._id).lean()).automaticOffAllowed, false);
  checks.push("Disconnect flow names affected devices and resets permissions/cancels native work");
  assert.deepEqual(errors, []);
  await writeFile(".local/connected-devices-browser-verification.json", JSON.stringify({ at: new Date().toISOString(), isolated: true, checks, errors, physicalEquipmentTested: false }, null, 2));
  console.log(`${checks.length} connected-device browser checks passed; isolated simulation, no physical equipment or saved credentials used.`);
} catch (error) {
  if (models) await writeFile(".local/connected-devices-worker-failure.json", JSON.stringify({ workerTicks, jobs: await models.Job.find({ kind: "native_off" }).lean(), commands: await models.NativeCommand.find().lean(), rooms: await models.Room.find().select("code commandLockOwner commandLockUntil nativeOffMode").lean() }, null, 2));
  if (page) {
    await page.screenshot({ path: ".local/screenshots/connected-devices-failure.png", fullPage: true }).catch(() => {});
    await writeFile(".local/connected-devices-browser-failure.json", JSON.stringify({ message: error.message, checks, errors, text: await page.evaluate(() => document.body.innerText).catch(() => "Unavailable") }, null, 2));
  }
  throw error;
} finally {
  running = false; if (worker) await worker;
  if (browser) await browser.close();
  if (runtime) await runtime.close();
  if (connection) await connection.close();
  if (db) await db.stop();
}
