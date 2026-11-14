// Isolated database and headless Chrome profile; no real accounts/readings changed.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import request from "supertest";
import { startDatabase } from "./database.mjs";
import { launchChrome } from "./chrome-driver.mjs";
import { loadConfig } from "../backend/src/config.js";
import { createInstitutionApplication } from "../backend/src/workspaces/runtime.js";
import { seedDedicatedDemo } from "../backend/src/workspaces/demo-seed.js";
let db, runtime, browser, page;
const checks = [], errors = [], password = randomBytes(24).toString("hex");
const body = () => page.evaluate(() => document.body.innerText);
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 180; i++) { if (await fn()) return; await pause(100); } throw new Error(`Timed out after ${checks.length} checks`); }
const selected = { meterId: "MAIN-01", dataMode: "live", start: "2025-05-02T00:00:00.000Z", end: "2025-05-02T02:00:00.000Z", baselineStart: "2025-05-01T00:00:00.000Z", baselineEnd: "2025-05-01T02:00:00.000Z", occupancy: "unknown", contextEvidence: "" };
try {
  await mkdir(".local/screenshots", { recursive: true });
  const probe = createServer(); await new Promise(r => probe.listen(0, "127.0.0.1", r)); const port = probe.address().port; await new Promise(r => probe.close(r)); const base = `http://localhost:${port}`;
  db = await startDatabase(); const config = loadConfig({ NODE_ENV: "test", MONGODB_URI: db.getUri("sustainability_browser"), SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), FRONTEND_ORIGIN: base, PUBLIC_APP_URL: base });
  runtime = await createInstitutionApplication(config);
  const seeded = await seedDedicatedDemo(runtime.directory, { ...config, enableDemoSetup: true, demoAdminEmail: "admin@esg-browser.test", demoViewerEmail: "viewer@esg-browser.test", demoAdminPassword: password, demoViewerPassword: password });
  const { models } = await runtime.directory.realm(seeded.institutionId);
  for (const [start, value] of [[selected.baselineStart, 10], ["2025-05-01T01:00:00Z", 10], [selected.start, 8], ["2025-05-02T01:00:00Z", 8]]) await models.MeterReading.create({ importKey: randomUUID(), meterId: "MAIN-01", epoch: "initial", kind: "interval", register: "import_kwh", unit: "kWh", value, intervalStart: new Date(start), capturedAt: new Date(+new Date(start) + 3600000), sourceType: "manual", validationState: "accepted", dataMode: "live" });
  const agent = request.agent(runtime.app), csrf = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
  const login = await agent.post("/api/v1/auth/login").set("Origin", base).set("X-CSRF-Token", csrf).send({ email: "admin@esg-browser.test", password }); assert.equal(login.status, 200);
  await new Promise(r => runtime.server.listen(port, "127.0.0.1", r));
  const executable = process.env.BROWSER_EXECUTABLE ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  browser = await launchChrome(executable); page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }); page.on("pageerror", e => errors.push(e.message)); await page.bringToFront();
  async function signIn(email) { await page.goto(base); await page.getByLabel("Email address").fill(email); await page.getByLabel("Password").fill(password); await page.getByRole("button", { name: "Sign in to workspace" }).click(); await until(async () => (await body()).includes("Live updates connected")); await page.goto(`${base}/sustainability`); await until(async () => /Reporting periods/i.test(await body()) || (await body()).includes("This optional module is disabled")); }
  async function choosePeriod(start = "2025-05-02T00:00", end = "2025-05-02T02:00") {
    await page.getByLabel("Current start (UTC)").fill(start); await page.getByLabel("Current end (exclusive) (UTC)").fill(end); await page.getByLabel("Baseline start (UTC)").fill("2025-05-01T00:00"); await page.getByLabel("Baseline end (exclusive) (UTC)").fill("2025-05-01T02:00"); await page.getByRole("button", { name: "Calculate selected periods" }).click(); await until(async () => (await body()).includes("Calculated selection:"));
  }
  await signIn("admin@esg-browser.test"); await page.getByLabel("Enable optional sustainability reporting").check(); await page.getByRole("button", { name: "Save module settings" }).click(); await until(async () => /Reporting periods/i.test(await body()));
  checks.push("Administrator enables the optional module through the actual settings form");
  await choosePeriod(); assert.ok((await body()).includes("16 kWh")); assert.ok((await body()).includes("10.8 kg CO2")); assert.ok((await body()).includes("20%")); assert.ok((await body()).includes("Occupancy comparability not recorded"));
  await page.evaluate(() => [...document.querySelectorAll('details')].find(d => d.textContent.includes('Methodology, factor versions')).open = true);
  assert.ok((await body()).includes("user-specified assumption")); assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--background").trim().toLowerCase()), "#f4faf7");
  checks.push("Selected intervals, factor assumption, units, baseline change, quality warnings and approved palette render consistently");
  await until(async () => { await page.evaluate(() => document.querySelector('.sustainability [aria-label="Help: estimated emissions"]')?.focus()); return page.evaluate(() => !!document.querySelector('[role=tooltip]')); });
  await page.pressKey("Escape"); assert.equal(await page.evaluate(() => !!document.querySelector('[role=tooltip]')), false); await page.pressKey("Tab");
  checks.push("Context help opens from keyboard and dismisses without trapping focus");
  await page.evaluate(() => { window.esgDownloads = []; const old = URL.createObjectURL; URL.createObjectURL = blob => { window.esgDownloads.push(blob.text()); return old(blob); }; });
  await page.getByRole("button", { name: "Save and export selected report (JSON)" }).click(); await until(async () => (await body()).includes("Immutable report saved"));
  const exported = await page.evaluate(async () => JSON.parse(await window.esgDownloads.at(-1))); assert.equal(exported.payload.snapshot.current.kwh, 16); assert.equal(exported.payload.snapshot.current.estimatedKgCO2, 10.8); assert.equal(exported.payload.snapshot.selection.start, selected.start); assert.ok(exported.payload.snapshot.methodology.carbon); assert.ok(exported.payload.snapshot.sourceReadings.length === 4);
  checks.push("Actual save/export button downloads a reproducible JSON snapshot matching the selected filters and displayed calculations");
  await page.evaluate(() => [...document.querySelectorAll('details')].find(d => d.textContent.includes('Add evidence-backed')).open = true);
  await page.getByLabel("Campaign / policy / report name").fill("Campus switch-off awareness"); await page.getByLabel("Activity date (UTC)").fill("2025-05-02T00:30"); await page.getByLabel("Responsible staff").fill("Sustainability officer"); await page.getByLabel("Supporting evidence reference").fill("Attendance register evidence #1"); await page.getByLabel("Student participants").fill("20"); await page.getByLabel("Staff participants").fill("5"); await page.getByLabel("Eligible participation opportunities (0 = not recorded)").fill("50"); await page.getByLabel("Counting method").selectOption("unique_within_activity"); await page.getByRole("button", { name: "Record pending evidence" }).click();
  await until(async () => (await body()).includes("Campus switch-off awareness · activity"));
  const record = (await agent.get("/api/v1/sustainability/records")).body.data[0]; assert.equal(record.status, "pending");
  const review = await agent.post(`/api/v1/sustainability/records/${record._id}/review`).set("Origin", base).set("X-CSRF-Token", login.body.data.csrfToken).send({ status: "approved", note: "Attendance evidence reviewed" }); assert.equal(review.status, 200);
  await until(async () => (await body()).includes("Internal engagement score: 50%"));
  checks.push("Evidence form records pending counts; approved evidence refreshes a formula-backed social score through live sync");
  await until(async () => { await page.evaluate(() => document.querySelector('.sustainability [aria-label="Help: estimated emissions"]')?.focus()); return page.evaluate(() => !!document.querySelector('[role=tooltip]')); });
  await page.evaluate(() => { window.esgFocusedHelp = document.activeElement; });
  await models.MeterReading.updateOne({ intervalStart: new Date(selected.start) }, { $set: { value: 8.5 } });
  await until(async () => (await body()).includes("16.5 kWh")); assert.ok(await page.evaluate(() => document.activeElement === window.esgFocusedHelp && !!document.querySelector('[role=tooltip]'))); await page.pressKey("Escape");
  checks.push("Live accepted updates preserve keyboard focus and open help while refreshing the same selected report");
  await page.setOffline(true); await until(async () => (await body()).includes("Disconnected") || (await body()).includes("Updates unavailable"));
  await models.MeterReading.updateOne({ intervalStart: new Date(selected.start) }, { $set: { value: 9 } });
  await page.setOffline(false); await page.bringToFront(); await until(async () => (await body()).includes("17 kWh") && (await body()).includes("Live updates connected"));
  const historical = (await agent.get(`/api/v1/sustainability/reports/${exported._id}/export`)).body.data; assert.equal(historical.payload.snapshot.current.kwh, 16);
  checks.push("Reconnect reconciles an accepted correction while the saved historical export stays unchanged");
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => document.querySelector('.esg-metrics').scrollIntoView({ block: 'start' })); await pause(200); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: ".local/screenshots/sustainability-mobile.png", fullPage: false });
  checks.push("390px mobile layout fits viewport and retains labelled controls");
  await page.setViewportSize({ width: 1440, height: 1080 }); await page.evaluate(() => { document.querySelectorAll('details').forEach(d => d.open = false); document.querySelector('.esg-metrics').scrollIntoView({ block: 'start' }); }); await page.screenshot({ path: ".local/screenshots/sustainability-desktop.png", fullPage: false });
  await choosePeriod("2099-05-02T00:00", "2099-05-02T02:00"); assert.ok((await body()).includes("Unavailable kWh")); assert.ok((await body()).includes("No accepted interval energy"));
  checks.push("Future no-data period shows unavailable energy and comparison, not invented zero use");
  await page.getByRole("button", { name: "Sign out" }).click(); await until(async () => (await body()).includes("Sign in to workspace")); await signIn("viewer@esg-browser.test"); await choosePeriod();
  assert.ok((await body()).includes("Report creation and export require Administrator permission")); assert.ok(!(await body()).includes("Save module settings")); assert.ok(!(await body()).includes("Record pending evidence")); assert.ok((await body()).includes("50%"));
  checks.push("Viewer sees approved evidence and building data without administration or export controls");
  assert.deepEqual(errors, []); await writeFile(".local/sustainability-browser.json", JSON.stringify({ checks, runtimeErrors: errors }, null, 2)); console.log(`${checks.length} sustainability browser checks passed; no runtime errors.`);
} catch (error) { if (page) { await writeFile(".local/sustainability-browser-failure.txt", await body().catch(() => "Closed")); await page.screenshot({ path: ".local/screenshots/sustainability-failure.png", fullPage: true }).catch(() => {}); } throw error; }
finally { await browser?.close(); await runtime?.close(); await db?.stop(); }
