import { launchChrome } from "./chrome-driver.mjs";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { loadConfig } from "../backend/src/config.js";

const config = loadConfig();
if (!config.demoMode || config.env === "production")
  throw new Error(
    "Browser smoke scenarios require isolated demonstration mode",
  );
const executablePath =
  process.env.BROWSER_EXECUTABLE ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find(existsSync);
if (!executablePath)
  throw new Error(
    "Set BROWSER_EXECUTABLE to an installed Chromium browser; no browser is downloaded automatically",
  );
const base = process.env.BROWSER_BASE_URL ?? "http://localhost:5173";
await mkdir(".local/screenshots", { recursive: true });
const browser = await launchChrome(executablePath);
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } }),
  errors = [],
  checks = [];
page.on("pageerror", (err) => errors.push(err.message));
async function api(path, body) {
  return page.evaluate(
    async ({ path, body }) => {
      const csrf = await fetch("/api/v1/auth/csrf").then((r) => r.json());
      const response = await fetch(`/api/v1${path}`, {
        method: body ? "POST" : "GET",
        headers: body
          ? {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrf.data.csrfToken,
            }
          : {},
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error?.message);
      return json.data;
    },
    { path, body },
  );
}
async function waitFor(operation, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await operation();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Timed out waiting for a persisted demo outcome");
}
try {
  await page.goto(base);
  await page.getByLabel("Email address").fill("admin@campus.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in to workspace" }).click();
  await page
    .getByRole("heading", { name: "A clearer view of your energy." })
    .waitFor();
  checks.push("Browser session login and connected overview");
  await page.locator(".recharts-surface").first().waitFor();
  await page.screenshot({
    path: ".local/screenshots/overview-desktop.png",
    fullPage: true,
  });
  for (const [route, title] of [
    ["/rooms", "Rooms, with context."],
    ["/energy", "Every interval tells a story."],
    ["/timetable", "Right room. Right time."],
    ["/incidents", "A signal. An owner. An outcome."],
    ["/recommendations", "Insights that lead somewhere."],
    ["/access", "Authorised access, made simple."],
    ["/admin", "Configure with confidence."],
  ]) {
    await page.goto(`${base}${route}`);
    await page.getByRole("heading", { name: title }).waitFor();
    checks.push(`Connected page ${route}`);
  }
  await page.goto(`${base}/rooms`);
  await page.getByRole("heading", { name: "Rooms, with context." }).waitFor();
  await page
    .getByRole("button", { name: "View room & actions" })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Forgotten lights", exact: true })
    .click();
  const incident = await waitFor(async () => {
    const rows = await api("/incidents");
    return rows.find(
      (i) => i.roomId === "room-r101" && i.type === "vacancy" && i.active,
    );
  });
  const outcome = await waitFor(async () => {
    const i = await api(`/incidents/${incident._id}`);
    return i.state === "resolved" ? i : null;
  });
  assert.equal(outcome.resolution.method, "simulated");
  assert.equal(outcome.commands[0].result.verification, "simulated");
  assert.ok(outcome.timeline.some((e) => e.event === "second_notification"));
  checks.push("Full persisted first alert → HOD escalation → simulated OFF");
  await page
    .getByRole("button", { name: "Person returns", exact: true })
    .click();
  await waitFor(async () => {
    const status = await api("/rooms/room-r101/status");
    return (
      status.breaker.reportedSupply === "on" &&
      status.observed.state === "occupied"
    );
  }, 10000);
  checks.push("Eligible occupancy restoration after simulated automation OFF");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.goto(`${base}/access`);
  await page
    .getByRole("heading", { name: "Authorised access, made simple." })
    .waitFor();
  await page.getByLabel("Room", { exact: true }).selectOption("room-r102");
  await page.getByLabel("Requested duration · policy minutes").fill("2");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Request authorised supply" }).click();
  await page.getByRole("button", { name: "Extend 2 min" }).first().waitFor();
  await page.getByRole("button", { name: "Extend 2 min" }).first().click();
  checks.push("Browser QR lease creation and extension");
  await page
    .getByRole("button", { name: "End lease", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Generate room QR" }).click();
  await page.getByAltText("QR code for the selected room access URL").waitFor();
  checks.push("Opaque room access QR generated");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  await page
    .getByRole("heading", { name: "A clearer view of your energy." })
    .waitFor();
  await page.locator(".recharts-surface").first().waitFor();
  await page.screenshot({
    path: ".local/screenshots/overview-mobile.png",
    fullPage: true,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "Mobile page overflows horizontally",
  );
  await page.getByRole("button", { name: "Toggle navigation" }).click();
  await page.getByRole("link", { name: "Rooms", exact: true }).click();
  await page.getByRole("heading", { name: "Rooms, with context." }).waitFor();
  checks.push("390px responsive layout and mobile navigation");
  await api("/demo/reset", {});
  assert.deepEqual(errors, [], "Browser runtime errors");
  console.log(
    `${checks.length} browser checks passed. Screenshots saved under ignored .local/screenshots/. No credentials were printed.`,
  );
  await writeFile(
    ".local/browser-verification.json",
    JSON.stringify(
      { at: new Date().toISOString(), base, checks, errors },
      null,
      2,
    ),
  );
} catch (err) {
  await page
    .screenshot({
      path: ".local/screenshots/browser-failure.png",
      fullPage: true,
    })
    .catch(() => {});
  const text = await page
    .evaluate(() => document.body.innerText)
    .catch(() => "Page text unavailable");
  await writeFile(
    ".local/browser-failure.txt",
    JSON.stringify({ message: err.message, errors, text }, null, 2),
  );
  throw err;
} finally {
  await browser.close();
}
