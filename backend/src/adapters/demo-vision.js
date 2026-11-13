import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { fail } from "../security/access.js";

// One worker per API, at most two outstanding frames globally. No unlimited
// queue, remote URL fetching, model downloads or live-control path.
export function createDemoVision(config) {
  let child, buffer = "", stopping = false;
  const pending = new Map();
  function stop() {
    const old = child; child = undefined; buffer = "";
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(Object.assign(new Error("Vision worker unavailable; occupancy is unknown"), { status: 503, code: "VISION_UNAVAILABLE" })); }
    pending.clear(); old?.kill();
  }
  function start() {
    if (child) return;
    stopping = false;
    child = spawn(config.demoVisionPython ?? "python", ["-u", fileURLToPath(new URL("../../../vision/demo_worker.py", import.meta.url))], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
    const current = child;
    current.on("error", () => { if (child === current) stop(); }); current.on("exit", () => { if (child === current) stop(); });
    current.stderr.on("data", () => {}); // Never log raw frame inputs or worker errors.
    current.stdin.on("error", () => { if (!stopping) stop(); });
    current.stdout.on("data", chunk => {
      if (child !== current) return;
      buffer += chunk.toString(); if (buffer.length > 450000) return stop();
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
        let item; try { item = JSON.parse(line); } catch { return stop(); }
        const task = pending.get(item.id); if (!task) continue;
        pending.delete(item.id); clearTimeout(task.timer);
        if (item.error) task.reject(Object.assign(new Error("Frame cannot be decoded safely"), { status: 400, code: "INVALID_FRAME" }));
        else task.resolve(item.result);
      }
    });
  }
  return {
    async process(input) {
      if (pending.size >= 2) fail(429, "VISION_BUSY", "Vision is busy; discard this frame and sample a new one");
      start(); const id = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(stop, 8000);
        pending.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ ...input, id }) + "\n");
      });
    },
    async close() { stopping = true; stop(); },
  };
}
