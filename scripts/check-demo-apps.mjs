import { readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { demoApps } from "./build-demo-apps.mjs";
for (const [, artifact] of Object.values(demoApps)) {
  const path = new URL(`../dist/${artifact}/index.html`, import.meta.url), html = await readFile(path, "utf8");
  if (html.includes('src="/socket.io/')) throw new Error("Standalone app still depends on a backend script asset");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) if (match[1].startsWith(".")) await access(new URL(match[1], path));
  const config = await readFile(new URL(`../dist/${artifact}/shared/config.js`, import.meta.url), "utf8");
  if (/localhost|127\.0\.0\.1/.test(config)) throw new Error("Production phone build contains a loopback backend origin");
}
for (const folder of ["cctv-camera", "circuit-board", "meter-camera", "virtual-meter"]) {
  const path = new URL(`../demo/${folder}/index.html`, import.meta.url), html = await readFile(path, "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) if (match[1].startsWith(".")) await access(new URL(match[1], path));
}
for (const path of ["demo/cctv-camera/main.js", "demo/circuit-board/main.js", "demo/shared/phone.js", "demo/shared/config.js", "demo/shared/image-source.js", "demo/meter-camera/main.js", "demo/virtual-meter/main.js"]) {
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr);
}
console.log("Four independent phone/classroom/meter build artifacts and source entries validated; local assets and generated production origins checked.");
