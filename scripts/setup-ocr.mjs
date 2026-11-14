// Explicit optional local setup; normal startup never installs software/models.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const result = spawnSync(process.env.OCR_PYTHON ?? "python", ["-m", "pip", "install", "--only-binary=:all:", "--target", `${root}/.local/ocr-python`, "-r", `${root}/vision/requirements-ocr.txt`], { stdio: "inherit", windowsHide: true });
if (result.status !== 0) throw new Error("Install a supported Python binary/wheel for the pinned OCR dependencies; see METER_CAMERA.md");
await mkdir(`${root}/.local/ocr-tessdata`, { recursive: true });
const path = `${root}/.local/ocr-tessdata/eng.traineddata`, digest = "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2";
let content; try { content = await readFile(path); } catch {}
if (!content || createHash("sha256").update(content).digest("hex") !== digest) {
  const response = await fetch("https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/eng.traineddata", { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error("Official OCR model download failed");
  content = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(content).digest("hex") !== digest) throw new Error("OCR model checksum mismatch");
  await writeFile(path, content, { mode: 0o600 });
}
console.log("Pinned optional OCR dependencies/model ready in ignored .local; no system installation or credentials changed.");
