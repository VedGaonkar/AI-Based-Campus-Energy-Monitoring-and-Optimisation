import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fail } from "../security/access.js";
let active = 0;
export async function recogniseMeter(config, input) {
  if (active >= 2) fail(429, "OCR_BUSY", "OCR is busy; retry this capture shortly");
  active++;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(config.ocrPython ?? "python", ["-u", fileURLToPath(new URL("../../../vision/meter_ocr.py", import.meta.url))], {
        stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", ...(config.ocrModulePath ? { OCR_MODULE_PATH: config.ocrModulePath } : {}), ...(config.ocrTessdataPath ? { OCR_TESSDATA_PATH: config.ocrTessdataPath } : {}) },
      });
      let output = "", settled = false;
      const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) { child.kill(); reject(error); } else resolve(value); };
      const unavailable = code => Object.assign(new Error("Meter OCR unavailable. Run npm run setup:ocr or check OCR_PYTHON, OCR_MODULE_PATH and OCR_TESSDATA_PATH."), { status: 503, code });
      const timer = setTimeout(() => finish(unavailable("OCR_TIMEOUT")), 12000);
      child.on("error", () => finish(unavailable("OCR_UNAVAILABLE")));
      child.stdin.on("error", () => finish(unavailable("OCR_UNAVAILABLE")));
      child.stderr.on("data", () => {});
      child.stdout.on("data", chunk => { output += chunk.toString(); if (output.length > 24000) finish(unavailable("OCR_RESPONSE_LIMIT")); });
      child.on("close", () => {
        try { const value = JSON.parse(output); if (value.error) finish(Object.assign(new Error(value.error === "INVALID_METER_IMAGE" ? "Use a bounded JPEG/PNG with a valid readable crop" : unavailable(value.error).message), { code: value.error, status: value.error === "INVALID_METER_IMAGE" ? 400 : 503 })); else finish(null, value.result); }
        catch { finish(unavailable("OCR_UNAVAILABLE")); }
      });
      child.stdin.end(JSON.stringify(input));
    });
  } finally { active--; }
}
