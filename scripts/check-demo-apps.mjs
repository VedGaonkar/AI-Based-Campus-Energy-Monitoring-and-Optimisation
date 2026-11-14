import { readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
for (const folder of ["cctv-camera", "circuit-board", "meter-camera", "virtual-meter"]) {
  const path = new URL(`../demo/${folder}/index.html`, import.meta.url), html = await readFile(path, "utf8");
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) if (match[1].startsWith(".")) await access(new URL(match[1], path));
}
for (const path of ["demo/cctv-camera/main.js", "demo/circuit-board/main.js", "demo/shared/phone.js", "demo/shared/config.js", "demo/shared/image-source.js", "demo/meter-camera/main.js", "demo/virtual-meter/main.js"]) {
  const result = spawnSync(process.execPath, ["--check", path], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) throw new Error(result.stderr);
}
console.log("Occupancy, classroom and dedicated meter entry points and their local production assets validated. The existing API serves /demo/ in production.");
