import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createServer as createViteServer } from "vite";
import { loadConfig } from "../backend/src/config.js";
import { connectDatabase } from "../backend/src/models/index.js";
import { startDatabase } from "./database.mjs";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const config = loadConfig();
if (config.env === "production")
  throw new Error(
    "Use separately supervised API/worker and an external MongoDB for production",
  );
const reachable = (port, host = "127.0.0.1") =>
  new Promise((resolve) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(1500);
    let finished = false;
    const done = (value) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(value);
    };
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
    socket.on("timeout", () => done(false));
  });
let database;
if (
  config.mongoUri === "mongodb://127.0.0.1:27017/campus_energy" &&
  !(await reachable(27017))
) {
  console.log(
    "Starting local persistent MongoDB (first run downloads a real binary)…",
  );
  database = await startDatabase({ persistent: true, port: 27017 });
}
const { connection, models } = await connectDatabase(config.mongoUri);
try {
  if (
    config.demoMode &&
    !(await models.Settings.exists({ _id: "installation" }))
  ) {
    console.log("No sample data is seeded at startup. Create an institution through onboarding, or explicitly enable and run demo setup/seeding.");
  }
} finally {
  await connection.close();
}
let frontend;
if (await reachable(5173, "localhost")) {
  const response = await fetch("http://localhost:5173/");
  const html = await response.text();
  if (!html.includes("Campus Energy"))
    throw new Error(
      "Port 5173 is occupied by another application; configure ports before continuing",
    );
  console.log(
    "Reusing the existing Campus Energy frontend on localhost:5173; it will not be stopped by this run.",
  );
} else {
  frontend = await createViteServer({
    root: fileURLToPath(new URL("../frontend/", import.meta.url)),
    configFile: fileURLToPath(
      new URL("../frontend/vite.config.js", import.meta.url),
    ),
  });
  await frontend.listen();
}
if (await reachable(config.port)) {
  if (frontend) await frontend.close();
  if (database) await database.stop();
  throw new Error(
    "API port is already in use; preserve that process and stop/reuse it deliberately",
  );
}
const children = [
  spawn(process.execPath, ["backend/src/server.js"], {
    stdio: "inherit",
    windowsHide: true,
  }),
  spawn(process.execPath, ["backend/src/workers/run.js"], {
    stdio: "inherit",
    windowsHide: true,
  }),
];
await mkdir(".local", { recursive: true });
const runId = randomUUID(),
  record = {
    runId,
    pid: process.pid,
    childPids: children.map((c) => c.pid),
    ownsDatabase: !!database,
    ownsFrontend: !!frontend,
    startedAt: new Date().toISOString(),
  };
await writeFile(".local/dev-session.json", JSON.stringify(record));
let stopping = false;
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(stopRequests);
  for (const child of children) child.kill("SIGTERM");
  await Promise.all(
    children.map((child) =>
      child.exitCode !== null
        ? Promise.resolve()
        : new Promise((resolve) => {
            child.once("exit", resolve);
            setTimeout(resolve, 5000).unref();
          }),
    ),
  );
  if (frontend) await frontend.close();
  if (database) await database.stop();
  await writeFile(
    ".local/dev-session.json",
    JSON.stringify({ ...record, stoppedAt: new Date().toISOString() }),
  );
  process.exit(code);
}
const stopRequests = setInterval(async () => {
  try {
    const request = JSON.parse(
      await readFile(".local/stop-request.json", "utf8"),
    );
    if (request.runId === runId) void stop();
  } catch {}
}, 500);
for (const child of children)
  child.on("exit", (code) => {
    if (!stopping) void stop(code ?? 1);
  });
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => void stop());
console.log(
  "Open http://localhost:5173. Sign in with email/password, or register an empty building workspace. Explicit showcase credentials use DEMO_ADMIN/VIEWER_EMAIL/PASSWORD in ignored .env.",
);
