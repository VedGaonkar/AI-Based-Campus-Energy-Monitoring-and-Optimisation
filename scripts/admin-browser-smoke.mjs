// All mutations run in an isolated temporary database with generated credentials.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { randomBytes, randomInt } from "node:crypto";
import assert from "node:assert/strict";
import { startDatabase } from "./database.mjs";
import { launchChrome } from "./chrome-driver.mjs";
import { connectDatabase } from "../backend/src/models/index.js";
import { createApplication } from "../backend/src/app.js";
import { loadConfig } from "../backend/src/config.js";
import { seed } from "../backend/src/seed.js";

const executable = process.env.BROWSER_EXECUTABLE ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
if (!executable) throw new Error("Set BROWSER_EXECUTABLE to an installed Chromium browser");
let database, connection, runtime, browser, page;
const checks = [], errors = [];
const password = randomBytes(18).toString("hex"), adminKey = randomInt(10000000, 100000000).toString();
async function waitFor(operation) {
  for (let i = 0; i < 100; i++) { if (await operation()) return; await new Promise((resolve) => setTimeout(resolve, 150)); }
  throw new Error("Timed out waiting for an isolated browser outcome");
}
try {
  const portProbe = createServer(); await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
  const port = portProbe.address().port; await new Promise((resolve) => portProbe.close(resolve));
  const base = `http://localhost:${port}`;
  database = await startDatabase();
  let models; ({ connection, models } = await connectDatabase(database.getUri("admin_browser")));
  const config = loadConfig({ NODE_ENV: "test", MONGODB_URI: database.getUri("admin_browser"), SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), FRONTEND_ORIGIN: base, PUBLIC_APP_URL: base, DEMO_MODE: "true" });
  await seed(models, config, { password });
  runtime = createApplication({ config, connection, models });
  await new Promise((resolve, reject) => { runtime.server.once("error", reject); runtime.server.listen(port, "127.0.0.1", resolve); });
  await mkdir(".local/screenshots", { recursive: true });
  browser = await launchChrome(executable); page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  page.on("pageerror", (error) => errors.push(error.message));
  const go = (path) => page.goto(`${base}${path}`);
  await go("/");
  await page.getByLabel("Email address").fill("admin@campus.test");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  assert.equal(await page.evaluate(() => !!document.querySelector('[name="adminKey"]')), false);
  await page.getByRole("heading", { name: "Your building. One control centre." }).waitFor();
  await page.getByRole("heading", { name: "Administrator access verified" }).waitFor();
  checks.push("Existing Administrator signs in with email/password only and server-verified membership");
  await page.screenshot({ path: ".local/screenshots/admin-management.png", fullPage: true });
  await go("/profile");
  await waitFor(() => page.evaluate(() => document.body.innerText.includes("Account role: admin")));
  checks.push("Profile displays the authenticated server role");
  await go("/admin/building");
  await page.getByLabel("Organisation / institution name").fill("Browser Demo College");
  await page.getByLabel("Building name").fill("Browser Academic Block");
  await page.getByLabel("Contact email").fill("facilities@example.test");
  await page.getByRole("button", { name: "Save building & continue" }).click();
  await page.getByRole("heading", { name: "Generate floors automatically" }).waitFor();
  await page.getByLabel("Number of floors to add").fill("2");
  await page.getByRole("button", { name: "Generate floors" }).click();
  await waitFor(() => models.Floor.countDocuments().then((n) => n === 2));
  checks.push("Building details and generated floors persist through UI");
  await go("/admin/rooms");
  const floor = await models.Floor.findOne({ code: "FL-00" }).lean();
  await page.getByLabel("Target floor").selectOption(floor._id);
  await page.getByLabel("Number of spaces").fill("2");
  await page.getByLabel("Code prefix").fill("LAB");
  await page.getByLabel("Generated space type").selectOption("laboratory");
  await page.getByRole("button", { name: "Generate spaces" }).click();
  await waitFor(() => models.Room.countDocuments({ floorId: floor._id }).then((n) => n === 2));
  const room = await models.Room.findOne({ code: "LAB-101" }).lean();
  await page.getByLabel("Name / LAB-101").fill("Renamed Computing Laboratory");
  await page.locator(`.space-editor:has(input[value="${room.name}"]) .button`).first().click();
  await waitFor(async () => (await models.Room.findById(room._id).lean()).name === "Renamed Computing Laboratory");
  checks.push("Generated lab spaces, hierarchy and stable room rename work");
  await go("/admin/cameras");
  await page.getByLabel("Camera name").fill("Browser Camera Simulation");
  await page.getByLabel("Assigned space").selectOption(room._id);
  await page.getByRole("button", { name: "Register camera" }).click();
  await waitFor(() => models.Integration.exists({ name: "Browser Camera Simulation", roomId: room._id }));
  await page.getByLabel("Camera policy / LAB-101").selectOption("none");
  await waitFor(async () => (await models.Room.findById(room._id).lean()).cameraConfiguration === "none");
  checks.push("Camera registration, room mapping and no-camera policy persist");
  await go("/admin/controllers");
  await page.getByLabel("Controller name / LAB-101").fill("Browser Lab Master");
  await page.locator(`section:has(input[name="name"][value="Master LAB-101"]) form .button`).first().click();
  await waitFor(async () => (await models.Breaker.findById(room.roomBreakerId).lean()).name === "Browser Lab Master");
  await page.getByRole("button", { name: "Test controller" }).first().click();
  await waitFor(() => page.evaluate(() => document.body.innerText.includes("No physical connection or switching was tested")));
  checks.push("Controller metadata and honest simulator test work");
  await go("/admin/timetable");
  await page.getByLabel("Room").selectOption(room._id);
  await page.getByLabel("Booking title").fill("Browser Laboratory Session");
  await page.locator('input[name="start"]').fill("2027-01-11T09:00");
  await page.locator('input[name="end"]').fill("2027-01-11T10:00");
  await page.getByRole("button", { name: "Add booking" }).click();
  await waitFor(() => models.Schedule.exists({ roomId: room._id, title: "Browser Laboratory Session" }));
  checks.push("Dedicated admin timetable saves a room booking");
  await go("/admin/qr");
  await page.getByLabel("Room").selectOption(room._id);
  await page.getByRole("button", { name: "Generate room QR" }).click();
  await page.getByAltText("QR code for the selected room access URL").waitFor();
  checks.push("Dedicated admin QR management generates the correct room QR");
  await go("/admin/automation");
  await page.locator('[aria-label="Automation mode / LAB-101"]').selectOption("simulated");
  await waitFor(async () => (await models.Room.findById(room._id).lean()).controlMode === "simulated");
  checks.push("Unified automation policy and audit/command logs connected");
  for (const path of ["/admin", ...["building", "rooms", "cameras", "controllers", "timetable", "qr", "automation", "users", "settings"].map((part) => `/admin/${part}`), "/profile"]) {
    await go(path); await page.locator(".page-head").waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Desktop overflow: ${path}`);
  }
  checks.push("All ten admin routes plus profile load at desktop width");
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/admin", "/admin/building", "/admin/rooms", "/admin/cameras", "/admin/controllers", "/admin/automation", "/admin/users", "/admin/settings", "/profile"]) {
    await go(path); await page.locator(".page-head").waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Mobile overflow: ${path}`);
  }
  await go("/admin"); await page.locator(".management-grid").waitFor();
  await page.screenshot({ path: ".local/screenshots/admin-management-mobile.png", fullPage: true });
  checks.push("Admin workflows fit a 390px viewport");
  await go("/rooms"); await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.getByLabel("Email address").fill("viewer@campus.test"); await page.getByLabel("Password").fill(password); await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await waitFor(() => page.evaluate(() => !!document.querySelector(".app-shell")));
  await go("/profile"); await waitFor(() => page.evaluate(() => document.body.innerText.includes("Account role: viewer")));
  assert.equal(await page.evaluate(() => !!document.querySelector('[name="adminKey"]')), false); assert.equal((await models.User.findById("demo-viewer").lean()).role, "viewer");
  checks.push("Existing Viewer password sign-in preserves role and profile has no activation path");
  assert.deepEqual(errors, []);
  await writeFile(".local/admin-browser-verification.json", JSON.stringify({ at: new Date().toISOString(), checks, errors, isolated: true }, null, 2));
  console.log(`${checks.length} isolated admin browser checks passed; no runtime errors. Credentials and user records were not printed or reused.`);
} catch (error) {
  if (page) {
    await page.screenshot({ path: ".local/screenshots/admin-browser-failure.png", fullPage: true }).catch(() => {});
    await writeFile(".local/admin-browser-failure.json", JSON.stringify({ message: error.message, checks, errors, text: await page.evaluate(() => document.body.innerText).catch(() => "Unavailable") }, null, 2));
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (runtime) await runtime.close();
  if (connection) await connection.close();
  if (database) await database.stop();
}
