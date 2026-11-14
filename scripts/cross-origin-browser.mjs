// Separate HTTP origins in a local dev harness; not a deployed TLS/certificate test.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer as probeServer } from "node:net";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import request from "supertest";
import { createServer } from "vite";
import { startDatabase } from "./database.mjs";
import { launchChrome } from "./chrome-driver.mjs";
import { loadConfig } from "../backend/src/config.js";
import { createInstitutionApplication } from "../backend/src/workspaces/runtime.js";
const proxyMode = process.argv.includes("--proxy");
let db, runtime, vite, browser, page;
const checks = [], errors = [], password = randomBytes(20).toString("hex"), adminKey = randomBytes(20).toString("hex");
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 200; i++) { if (await fn()) return; await pause(100); } throw new Error(`Cross-origin browser timeout after ${checks.length} checks`); }
async function port() { const p = probeServer(); await new Promise(r => p.listen(0, "127.0.0.1", r)); const value = p.address().port; await new Promise(r => p.close(r)); return value; }
try {
  await mkdir(".local", { recursive: true }); const apiPort = await port(), webPort = await port(), backend = `http://${proxyMode ? "127.0.0.1" : "localhost"}:${apiPort}`, frontend = `http://localhost:${webPort}`;
  db = await startDatabase(); runtime = await createInstitutionApplication(loadConfig({ NODE_ENV: "test", MONGODB_URI: db.getUri("cross_origin_browser"), SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), ADMIN_INVITE_KEY: adminKey, FRONTEND_ORIGIN: frontend, PUBLIC_APP_URL: backend }));
  const agent = request.agent(runtime.app), csrf = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
  const registration = await agent.post("/api/v1/auth/register").set("Origin", frontend).set("X-CSRF-Token", csrf).send({ name: "Cross Origin Admin", email: "admin@cross-origin.test", password, confirmPassword: password, accountType: "administrator", institutionName: "Origin institute", adminKey, joinCode: "Origin-Building-2026" }); assert.equal(registration.status, 201);
  const token = registration.body.data.csrfToken;
  const write = (path, body, method = "post") => agent[method](`/api/v1${path}`).set("Origin", frontend).set("X-CSRF-Token", token).send(body);
  const created = await write("/rooms", { code: "C1", name: "Original cross-origin room", roomBreakerId: "MASTER-C1" }); assert.equal(created.status, 201);
  await new Promise(r => runtime.server.listen(apiPort, "127.0.0.1", r));
  vite = await createServer({ root: fileURLToPath(new URL("../frontend", import.meta.url)), configFile: fileURLToPath(new URL("../frontend/vite.config.js", import.meta.url)), define: { "import.meta.env.VITE_API_ORIGIN": JSON.stringify(proxyMode ? "" : backend), "import.meta.env.VITE_REALTIME_ORIGIN": JSON.stringify(backend) }, server: { host: "localhost", port: webPort, strictPort: true, ...(proxyMode ? { proxy: { "/api": { target: backend }, "/assistant": { target: backend } } } : {}) } }); await vite.listen();
  const executable = process.env.BROWSER_EXECUTABLE ?? ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(existsSync);
  browser = await launchChrome(executable); page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.on("pageerror", e => errors.push(e.message)); await page.bringToFront();
  await page.goto(frontend); await page.getByLabel("Email address").fill("admin@cross-origin.test"); await page.getByLabel("Password").fill(password); await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await until(() => page.evaluate(() => document.body.innerText.includes("Live updates connected")));
  assert.ok(await page.evaluate(origin => performance.getEntriesByType('resource').some(e => e.name.startsWith(`${origin}/api/v1/`)), proxyMode ? frontend : backend));
  if (proxyMode) {
    const sockets = [...runtime.io.sockets.sockets.values()];
    assert.ok(sockets.some(socket => socket.data.syncSessionId && !socket.request.session.userId));
    checks.push("Different-site backend socket authenticates via signed session ticket without third-party cookies");
  }
  checks.push(proxyMode ? "Browser signs in through same-origin API proxy and connects directly to separate backend" : "Actual browser signs in with credentialed API requests to its configured separate backend origin and connects real-time updates");
  await page.goto(frontend); await until(() => page.evaluate(() => document.body.innerText.includes("Live updates connected")));
  checks.push("Browser refresh retains the authenticated stored session");
  if (proxyMode) { assert.equal(await page.evaluate(async () => (await fetch("/assistant/")).status), 200); checks.push("Authenticated assistant is reachable through the same-origin proxy"); }
  await page.goto(`${frontend}/rooms`); await until(() => page.evaluate(() => document.body.innerText.includes("Original cross-origin room")));
  assert.equal((await write(`/rooms/${created.body.data._id}`, { name: "Changed across origins" }, "patch")).status, 200);
  await until(() => page.evaluate(() => document.body.innerText.includes("Changed across origins")));
  checks.push("Authorised mutation in another session reaches the frontend through the configured cross-origin authenticated socket");
  await page.goto(`${frontend}/profile`); await until(() => page.evaluate(() => document.body.innerText.includes("Display name")));
  await page.getByLabel("Display name").fill("Updated cross-origin administrator"); await page.getByRole("button", { name: "Save profile" }).click();
  await until(async () => (await agent.get("/api/v1/auth/me")).body.data.user.name === "Updated cross-origin administrator");
  checks.push("Browser mutation across origins carries its session plus CSRF token and persists through the authorised API");
  await page.goto(`${frontend}/presenter`); await until(() => page.evaluate(() => document.querySelector("h1")?.textContent === "Two-phone demonstration"));
  assert.equal(await page.evaluate(() => !!document.querySelector('.sidebar')), false); await until(() => page.evaluate(() => document.querySelector('[data-read-state]')?.dataset.readState === "current")); await pause(250); await page.getByRole("button", { name: "Sign out" }).click(); await until(() => page.evaluate(() => document.body.innerText.includes("Sign in to workspace")));
  await page.goto(`${frontend}/presenter`); await page.getByLabel("Email address").waitFor();
  checks.push("Direct presenter is separately laid out and logout revokes the browser session across origins");
  assert.deepEqual(errors, []); await writeFile(proxyMode ? ".local/proxy-auth-browser.json" : ".local/cross-origin-browser.json", JSON.stringify({ checks, runtimeErrors: errors, topology: proxyMode ? "localhost HTTP proxy to 127.0.0.1 backend; cookie-free socket; deployed HTTPS not exercised" : "different same-site HTTP ports; HTTPS deployment/certificates not exercised" }, null, 2)); console.log(`${checks.length} cross-origin browser checks passed; no runtime errors.`);
} catch (error) { if (page) await writeFile(".local/cross-origin-browser-failure.txt", await page.evaluate(() => document.body.innerText).catch(() => "Unavailable")); throw error; }
finally { await browser?.close(); await vite?.close(); await runtime?.close(); await db?.stop(); }
