// Sequential profiles avoid distorting the bounded vision freshness workload.
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
const runners = [
  ["phone", "phone-demo-browser.mjs"], ["cross-origin", "cross-origin-browser.mjs"],
  ["auth", "institutions-browser.mjs"], ["admin", "admin-browser-smoke.mjs"],
  ["meter", "meter-camera-browser.mjs"], ["consumption", "consumption-browser.mjs"],
  ["sustainability", "sustainability-browser.mjs"], ["realtime", "realtime-browser.mjs"],
  ["devices", "connected-devices-browser.mjs"],
];
await mkdir(".local", { recursive: true });
const retry = process.argv.includes("--retry-failed");
const previous = retry ? JSON.parse(await readFile(".local/final-browser-results.json", "utf8")) : { results: [] };
const results = retry ? previous.results.filter(r => r.passed) : [];
const selected = retry ? runners.filter(([name]) => previous.results.some(r => r.name === name && !r.passed)) : runners;
for (const [name, file] of selected) {
  console.log(`Running isolated ${name} browser journey...`);
  const log = `.local/final-${name}-browser.log`, output = createWriteStream(log);
  const child = spawn(process.execPath, [`scripts/${file}`], { env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(output, { end: false }); child.stderr.pipe(output, { end: false });
  const exitCode = await new Promise((resolve, reject) => { child.once("close", resolve); child.once("error", reject); });
  await new Promise(resolve => output.end(resolve)); results.push({ name, exitCode, passed: exitCode === 0, log });
  await writeFile(".local/final-browser-results.json", JSON.stringify({ at: new Date().toISOString(), results, ...(retry ? { previousFailures: previous.results.filter(r => !r.passed) } : {}), physicalPhonesTested: false, physicalSwitchingTested: false }, null, 2));
  console.log(`${name}: ${exitCode === 0 ? "passed" : "FAILED"}; ${log}`);
}
if (results.some(r => !r.passed)) process.exitCode = 1;
