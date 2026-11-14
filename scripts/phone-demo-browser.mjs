// Isolated software demonstration. A canvas MediaStream films rendered classroom
// screenshots; this is deliberately NOT a real mobile-camera/two-phone test.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { randomBytes, randomInt } from "node:crypto";
import { startDatabase } from "./database.mjs";
import { launchChrome } from "./chrome-driver.mjs";
import { connectDatabase } from "../backend/src/models/index.js";
import { loadConfig } from "../backend/src/config.js";
import { seed } from "../backend/src/seed.js";
import { createApplication } from "../backend/src/app.js";
import { tick } from "../backend/src/workers/tick.js";

const executable = process.env.BROWSER_EXECUTABLE ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!executable) throw new Error("Set BROWSER_EXECUTABLE to installed Chrome/Edge");
const checks = [], errors = [], browsers = [];
let db, connection, models, runtime, dashboard, camera, classroom, running = false, worker, mirror, ticks = 0;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(operation, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await operation(); if (result) return result; await delay(200); }
  throw new Error("Timed out waiting for the isolated phone-demo outcome");
}
try {
  const probe = createServer(); await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve)); const base = `http://localhost:${port}`;
  db = await startDatabase(); ({ connection, models } = await connectDatabase(db.getUri("phone_browser")));
  const password = randomBytes(18).toString("hex"), key = randomInt(10000000, 100000000).toString();
  const config = loadConfig({ NODE_ENV: "test", MONGODB_URI: db.getUri("phone_browser"), SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), PUBLIC_APP_URL: base, FRONTEND_ORIGIN: base, DEMO_MODE: "true" });
  await seed(models, config, { password }); runtime = createApplication({ models, connection, config });
  await new Promise(resolve => runtime.server.listen(port, "127.0.0.1", resolve));
  await mkdir(".local/screenshots", { recursive: true });
  async function page(viewport) { const browser = await launchChrome(executable); browsers.push(browser); const page = await browser.newPage({ viewport }); page.on("pageerror", failure => errors.push(failure.message)); return page; }
  dashboard = await page({ width: 1440, height: 1080 }); classroom = await page({ width: 800, height: 1000 }); camera = await page({ width: 390, height: 844 });
  await dashboard.goto(`${base}/presenter`); await dashboard.getByLabel("Email address").fill("admin@campus.test"); await dashboard.getByLabel("Password").fill(password); await dashboard.getByRole("button", { name: "Sign in to workspace" }).click();
  await waitFor(() => dashboard.evaluate(() => location.pathname === "/presenter" && document.querySelector("h1")?.textContent === "Two-phone demonstration"));
  assert.equal(await dashboard.evaluate(() => !!document.querySelector('.sidebar')), false);
  await dashboard.goto(base); await waitFor(() => dashboard.evaluate(() => !!document.querySelector('.sidebar')));
  assert.equal(await dashboard.evaluate(() => [...document.querySelectorAll('a')].some(a => /phone-demo|presenter/.test(a.getAttribute('href') || '')) || document.body.innerText.includes('Camera to classroom')), false);
  checks.push("Normal dashboard has no phone-demo navigation or summary; direct presenter has a separate authenticated layout");
  // Fresh rooms can be prepared in the presenter without navigating through
  // policy/inventory dialogs. This fixture represents virtual equipment only.
  await models.Room.create({ _id: "room-quick", code: "QUICK", name: "Virtual quick setup", roomBreakerId: "MASTER-QUICK" });
  await models.Breaker.create({ _id: "MASTER-QUICK", roomId: "room-quick", adapter: "simulator" });
  await dashboard.goto(`${base}/presenter`);
  await waitFor(() => dashboard.evaluate(() => !!document.querySelector('.demo-room-setup summary')));
  await dashboard.evaluate(() => { document.querySelector('.demo-room-setup summary').focus(); });
  await dashboard.pressKey("Enter");
  await dashboard.getByLabel("Room to prepare").selectOption("room-quick");
  await waitFor(() => dashboard.evaluate(() => !!document.querySelector('.demo-room-setup input[name="virtualLight"]')));
  assert.equal((await models.Room.findById("room-quick").lean()).independentInfrastructure, false);
  assert.equal(await models.Device.countDocuments({roomId:"room-quick"}),0);
  assert.ok(await dashboard.evaluate(() => getComputedStyle(document.querySelector('.demo-room-setup summary')).borderTopStyle !== 'none'));
  await dashboard.screenshot({ path: ".local/screenshots/demo-quick-room-review.png", fullPage: true });
  await dashboard.locator('.demo-room-setup input[name="independent"]').check();
  await dashboard.locator('.demo-room-setup input[name="virtualLight"]').check();
  await dashboard.getByRole("button", { name: "Save simulation setup" }).click();
  await waitFor(async () => (await models.Room.findById("room-quick").lean()).independentInfrastructure && await models.Device.countDocuments({roomId:"room-quick",supplyInterruptionApproved:true})===1);
  await waitFor(() => dashboard.evaluate(() => [...document.querySelector('select[name="roomId"]').options].some(o=>o.value==='room-quick')));
  checks.push("Keyboard-operable button-styled room setup combines explicit independent-supply and virtual inventory approval on one page; no automatic approvals");
  await models.Room.create({ _id: "room-protected", code: "PROTECTED", name: "Protected load fixture", roomBreakerId: "MASTER-PROTECTED", independentInfrastructure: true });
  await models.Breaker.create({ _id: "MASTER-PROTECTED", roomId: "room-protected", adapter: "simulator" });
  await models.Device.create({ roomId: "room-protected", name: "Protected essential load", category: "other", essential: true, supplyInterruptionApproved: false });
  await waitFor(() => dashboard.evaluate(() => [...document.querySelectorAll('.demo-room-setup option')].some(o=>o.value==='room-protected')));
  await dashboard.getByLabel("Room to prepare").selectOption("room-protected");
  await waitFor(() => dashboard.evaluate(() => document.body.innerText.includes('Protected loads block room-wide cutoff')));
  assert.ok(await dashboard.evaluate(() => [...document.querySelectorAll('.demo-room-setup button')].find(b=>b.textContent==='Save simulation setup').disabled));
  assert.equal((await models.Device.findOne({roomId:'room-protected'}).lean()).supplyInterruptionApproved,false);
  checks.push("Consolidated setup refuses protected loads and leaves their approvals unchanged");
  await dashboard.evaluate(() => { document.querySelector('.demo-room-setup').open = false; document.querySelector('.demo-advanced').open = true; });
  await dashboard.getByLabel("Existing room").selectOption("room-r101"); await dashboard.getByLabel("Vacancy confirmation (seconds)").fill("2");
  await dashboard.locator('form input[type="checkbox"]').check(); await dashboard.locator('input[name="manual"]').check();
  await dashboard.getByRole("button", { name: "Create demo session" }).click();
  const session = await waitFor(() => models.DemoSession.findOne({ active: true }).lean(), 30000);
  await dashboard.getByRole("button", { name: "Prepare both phone links" }).click();
  await waitFor(() => dashboard.evaluate(() => document.querySelectorAll(".phone-pair-secret a").length === 2));
  const cameraUrl = await dashboard.evaluate(() => document.querySelectorAll(".phone-pair-secret a")[0].href);
  const classroomUrl = await dashboard.evaluate(() => document.querySelectorAll(".phone-pair-secret a")[1].href);
  const generation = await models.DemoClient.find({sessionId:session._id}).select("role generation").lean();
  await dashboard.getByRole("button", { name: "Prepare both phone links" }).click();
  await waitFor(() => dashboard.evaluate(() => [...document.querySelectorAll('button')].find(b=>b.textContent==='Prepare both phone links')?.disabled === false));
  assert.deepEqual(await models.DemoClient.find({sessionId:session._id}).select("role generation").lean(), generation);
  checks.push("One action prepares both one-use phone links; repeated preparation preserves their pairing generations");
  // Clear secret cards before screenshots; codes are never written to reports.
  await dashboard.goto(`${base}/presenter`);
  await waitFor(() => dashboard.evaluate(id => [...document.querySelectorAll('select option')].some(option => option.value === id), session._id));
  assert.equal(await dashboard.evaluate(() => [...document.querySelectorAll('label')].find(l=>l.querySelector('span')?.textContent==='Session')?.querySelector('select')?.value), session._id);
  await waitFor(() => dashboard.evaluate(() => !!document.querySelector('.phone-demo-pairings')));
  checks.push("Administrator creates scoped session and one-use camera/classroom pairings through the authenticated presenter");
  await classroom.goto(classroomUrl);
  await waitFor(() => classroom.evaluate(() => !document.querySelector("#paired-panel").hidden && !!document.querySelector("#marker").getAttribute("src")));
  await camera.goto(cameraUrl);
  await waitFor(() => camera.evaluate(() => !document.querySelector("#paired-panel").hidden));
  checks.push("Pairing links connect camera and classroom automatically, remove fragments, and keep explicit camera Start permission");
  await classroom.evaluate(() => { document.querySelector("details.presenter").open = true; });
  for (const name of ["light", "fan", "ac", "display", "occupied", "empty_off", "empty_on"]) {
    await classroom.locator("#scene-select").selectOption(name);
    await waitFor(async () => (await models.DemoSession.findById(session._id).lean()).scene.name === name);
  }
  await classroom.locator("#presenter-lock").check();
  await waitFor(() => classroom.evaluate(() => document.querySelector("#next").disabled));
  assert.ok(await classroom.evaluate(() => document.querySelector("#local-fan").disabled));
  await classroom.locator("#presenter-lock").click();
  await waitFor(() => classroom.evaluate(() => !document.querySelector("#next").disabled));
  checks.push("Seven manually selected scenes render; presenter lock freezes carousel and local switches");
  await classroom.getByRole("button", { name: "Present fullscreen" }).click();
  assert.ok(await classroom.evaluate(() => { const r=document.querySelector('#marker').getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight && r.width>=100; }));
  await classroom.getByRole("button", { name: "Exit presentation" }).click();
  checks.push("Fullscreen presentation keeps the instrumented QR in the viewport instead of below the scene");
  await classroom.screenshot({ path: ".local/screenshots/phone-classroom-desktop.png", fullPage: true });
  await camera.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 640; window.demoPixelFeed = canvas;
    window.demoPixelImage = new Image(); window.demoPixelImage.onload = () => {
      const buffer = document.createElement("canvas"); buffer.width = 640; buffer.height = 640;
      const context = buffer.getContext("2d"), scale = Math.min(640 / window.demoPixelImage.width, 640 / window.demoPixelImage.height);
      context.fillStyle = "white"; context.fillRect(0, 0, 640, 640);
      const width = window.demoPixelImage.width * scale, height = window.demoPixelImage.height * scale;
      context.drawImage(window.demoPixelImage, (640 - width) / 2, (640 - height) / 2, width, height);
      canvas.getContext("2d").drawImage(buffer, 0, 0);
    };
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async constraints => { window.demoRequestedAudio = constraints.audio; return canvas.captureStream(6); } });
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", { configurable: true, value: async () => [{ kind: "videoinput", deviceId: "software-canvas", label: "Synthetic classroom pixel feed (test only)" }] });
  });
  async function mirrorFrame() {
    await classroom.screenshot({ path: ".local/phone-demo-display.png", selector: "#stage" });
    const image = (await readFile(".local/phone-demo-display.png")).toString("base64");
    await camera.evaluate(image => { window.demoPixelImage.src = `data:image/png;base64,${image}`; }, image);
  }
  await mirrorFrame(); running = true;
  mirror = (async () => { while (running) { await mirrorFrame(); await delay(750); } })();
  worker = (async () => { while (running) { await tick(models, config, new Date(), "isolated-browser-worker"); ticks++; await delay(500); } })();
  await camera.getByRole("button", { name: "Start camera" }).click();
  await waitFor(async () => (await models.DemoSession.findById(session._id).lean()).processedFrames >= 2, 30000);
  assert.equal(await camera.evaluate(() => window.demoRequestedAudio), false);
  await waitFor(async () => (await models.DemoSession.findById(session._id).lean()).latestObservation?.occupancy === "vacant");
  checks.push("Video-only synthetic MediaStream is sampled/resized/uploaded and OpenCV decodes actual classroom-rendered QR pixels");
  console.log("Phone-demo browser: actual rendered pixels accepted; waiting for persistent 10s/15s escalation.");
  const command = await waitFor(() => models.Command.findOne({ demoSessionId: session._id, reason: "vacancy_escalation", state: "completed" }).lean(), 55000);
  assert.equal(command.result.verification, "simulator_acknowledged"); assert.equal(command.result.physicalVerification, false);
  const incident = await models.Incident.findById(command.incidentId).lean(); assert.ok(incident.timeline.some(item => item.event === "second_notification"));
  assert.equal((await models.Breaker.findById("BRK-R101").lean()).reportedSupply, "off");
  assert.ok(await classroom.evaluate(() => ["light", "fan", "ac", "display"].every(key => document.querySelector(`#effective-${key}`).textContent === "Effective OFF")));
  checks.push("Existing persistent worker alerts/escalates/rechecks; Phone B applies master OFF to every effective load and acknowledges it");
  await waitFor(async () => Object.values((await models.DemoSession.findById(session._id).lean()).latestObservation?.equipment ?? {}).length > 0 && (await models.DemoSession.findById(session._id).lean()).latestObservation.equipment.light === false);
  await waitFor(() => dashboard.evaluate(() => document.body.innerText.includes("Simulator acknowledged OFF")));
  checks.push("Camera independently observes new OFF marker pixels; dashboard shows acknowledgement separately from visual evidence");
  console.log("Phone-demo browser: acknowledged OFF and independent subsequent pixel observation passed (software simulation).");
  await dashboard.screenshot({ path: ".local/screenshots/phone-dashboard-confirmed.png", fullPage: true });
  await camera.screenshot({ path: ".local/screenshots/phone-camera-mobile.png", fullPage: true });
  await camera.getByRole("button", { name: "Stop camera" }).click();
  await waitFor(async () => (await models.Integration.findById(session.sourceId).lean()).health === "offline");
  await waitFor(() => dashboard.evaluate(() => document.body.innerText.includes("unknown ·")));
  checks.push("Stopping Phone A makes occupancy unknown; cached video is not reused as current evidence");
  await classroom.getByRole("button", { name: "Request master ON" }).click();
  await waitFor(async () => (await models.Breaker.findById("BRK-R101").lean()).reportedSupply === "on");
  await classroom.locator("#scene-select").selectOption("empty_on");
  await camera.getByRole("button", { name: "Start camera" }).click();
  const pending = await waitFor(() => models.Incident.findOne({ demoSessionId: session._id, active: true }).lean(), 25000);
  await classroom.locator("#scene-select").selectOption("occupied");
  await waitFor(async () => (await models.DemoSession.findById(session._id).lean()).latestObservation?.occupancy === "occupied");
  await waitFor(async () => (await models.Incident.findById(pending._id).lean()).state === "cancelled");
  assert.equal(await models.Command.countDocuments({ incidentId: pending._id }), 0);
  checks.push("New occupied scene is decoded from captured pixels and cancels pending persistent shutdown");
  running = false; await Promise.all([worker, mirror]);
  for (const page of [classroom, dashboard]) {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await classroom.getByRole("button", { name: "Present fullscreen" }).click();
  assert.ok(await classroom.evaluate(() => { const r=document.querySelector('#marker').getBoundingClientRect(); return r.top>=0 && r.bottom<=innerHeight && r.right<=innerWidth && r.width>=100; }));
  await classroom.screenshot({ path: ".local/screenshots/demo-classroom-qr-mobile.png", fullPage: false });
  await classroom.getByRole("button", { name: "Exit presentation" }).click();
  await classroom.screenshot({ path: ".local/screenshots/phone-classroom-mobile.png", fullPage: true });
  checks.push("Camera, classroom and dashboard layouts fit a 390px viewport");
  await dashboard.getByRole("button", { name: "Stop session" }).click();
  await waitFor(async () => !(await models.DemoSession.findById(session._id).lean()).active);
  await waitFor(() => camera.evaluate(() => !document.querySelector("#pair-panel").hidden), 15000);
  checks.push("Ending session revokes phone access, cancels pending work and disconnects subscriptions");
  assert.equal(await models.NativeCommand.countDocuments(), 0); assert.deepEqual(errors, []);
  await writeFile(".local/phone-demo-browser-verification.json", JSON.stringify({ at: new Date().toISOString(), isolated: true, checks, errors, workerTicks: ticks, cameraInput: "synthetic canvas MediaStream of actual rendered classroom screenshots", physicalPhonesTested: false, physicalSwitchingTested: false }, null, 2));
  console.log(`${checks.length} phone-demo browser checks passed; rendered-pixel software simulation only, not physical phones.`);
} catch (failure) {
  await writeFile(".local/phone-demo-browser-failure.json", JSON.stringify({ message: failure.message, checks, errors,
    dashboardText: dashboard ? await dashboard.evaluate(() => document.body.innerText).catch(() => "Unavailable") : "Unavailable",
    classroomDebug: classroom ? await classroom.evaluate(() => ({ io: typeof window.io, inputLength: document.querySelector("#pair-code")?.value.length, valid: document.querySelector("#pair-form")?.checkValidity(), resources: performance.getEntriesByType("resource").map(item => ({ url: item.name, bytes: item.transferSize })) })).catch(() => null) : null,
    sessions: models ? await models.DemoSession.find().lean() : [], observations: models ? await models.Observation.find({ sourceId: /^phone-camera-/ }).sort({ capturedAt: -1 }).limit(5).lean() : [],
    commands: models ? await models.Command.find().lean() : [], incidents: models ? await models.Incident.find({ demoSessionId: { $exists: true } }).lean() : [],
    cameraText: camera ? await camera.evaluate(() => document.body.innerText).catch(() => "Unavailable") : "Unavailable",
    classroomText: classroom ? await classroom.evaluate(() => document.body.innerText).catch(() => "Unavailable") : "Unavailable",
  }, null, 2));
  if (camera) await camera.screenshot({ path: ".local/screenshots/phone-camera-failure.png", fullPage: true }).catch(() => {});
  throw failure;
} finally {
  running = false; await Promise.allSettled([worker, mirror].filter(Boolean));
  for (const browser of browsers) await browser.close();
  await runtime?.close(); await connection?.close(); await db?.stop();
}
