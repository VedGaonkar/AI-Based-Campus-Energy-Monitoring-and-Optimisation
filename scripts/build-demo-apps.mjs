import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deploymentOrigin } from "../shared/deployment-origins.js";
const root = fileURLToPath(new URL("../", import.meta.url));
export const demoApps = { camera: ["cctv-camera", "phone-camera"], classroom: ["circuit-board", "virtual-classroom"], meter: ["meter-camera", "meter-camera"], "virtual-meter": ["virtual-meter", "virtual-meter"] };
export async function buildDemoApps({ role = "all", outputRoot = resolve(root, "dist"), apiOrigin = process.env.PHONE_API_ORIGIN ?? "", realtimeOrigin = process.env.PHONE_REALTIME_ORIGIN ?? apiOrigin } = {}) {
  const options = { production: true, optional: true };
  apiOrigin = deploymentOrigin(apiOrigin, { ...options, label: "PHONE_API_ORIGIN" }); realtimeOrigin = deploymentOrigin(realtimeOrigin, { ...options, label: "PHONE_REALTIME_ORIGIN" });
  const entries = role === "all" ? Object.entries(demoApps) : [[role, demoApps[role]]];
  if (entries.some(([, row]) => !row)) throw new Error("Select camera, classroom, meter, virtual-meter or all");
  for (const [, [source, artifact]] of entries) {
    const base = resolve(outputRoot), target = resolve(base, artifact);
    if (target === base || !target.startsWith(`${base}${sep}`)) throw new Error("Build target must stay inside its explicit output directory");
    await rm(target, { recursive: true, force: true }); await mkdir(target, { recursive: true });
    await cp(resolve(root, "demo", source), target, { recursive: true });
    await cp(resolve(root, "demo/shared"), resolve(target, "shared"), { recursive: true });
    await cp(resolve(root, "node_modules/socket.io/client-dist/socket.io.min.js"), resolve(target, "shared/socket.io.js"));
    // Entry-point references become local to this standalone artifact. Shared
    // imports stay together; no external CDN or backend JS asset is needed.
    for (const name of ["index.html", "main.js"]) {
      const path = resolve(target, name), original = await readFile(path, "utf8");
      await writeFile(path, original.replaceAll("../shared/", "./shared/").replaceAll('src="/socket.io/socket.io.js"', 'src="./shared/socket.io.js"'));
    }
    await writeFile(resolve(target, "shared/config.js"), `// Generated public origins only; never credentials.\nexport const BACKEND_ORIGIN = ${JSON.stringify(apiOrigin)};\nexport const REALTIME_ORIGIN = ${JSON.stringify(realtimeOrigin)};\n`);
    await writeFile(resolve(target, "build.json"), JSON.stringify({ app: artifact, apiOrigin: apiOrigin || "same-origin", realtimeOrigin: realtimeOrigin || apiOrigin || "same-origin" }, null, 2));
    console.log(`Built independent ${artifact} frontend in ${target}`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await buildDemoApps({ role: process.argv[2] || "all" });
