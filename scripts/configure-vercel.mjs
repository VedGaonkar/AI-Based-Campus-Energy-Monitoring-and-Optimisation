import { mkdir, writeFile } from "node:fs/promises";
import { deploymentOrigin } from "../shared/deployment-origins.js";

const backend = deploymentOrigin(process.argv[2], { production: true, label: "Backend origin argument" });
const output = new URL("../deployment/generated/", import.meta.url);
await mkdir(output, { recursive: true });
const common = { $schema: "https://openapi.vercel.sh/vercel.json", framework: null, installCommand: "npm ci --include=dev" };
const configurations = {
  main: { ...common, buildCommand: "npm run build:main", outputDirectory: "frontend/dist", rewrites: [
    { source: "/api/:path*", destination: `${backend}/api/:path*` },
    { source: "/assistant/:path*", destination: `${backend}/assistant/:path*` },
    { source: "/((?!api(?:/|$)|assistant(?:/|$)|assets/).*)", destination: "/index.html" },
  ] },
  camera: { ...common, buildCommand: "npm run build:phone-camera", outputDirectory: "dist/phone-camera" },
  classroom: { ...common, buildCommand: "npm run build:classroom", outputDirectory: "dist/virtual-classroom" },
};
for (const [name, configuration] of Object.entries(configurations)) {
  await writeFile(new URL(`vercel-${name}.json`, output), JSON.stringify(configuration, null, 2) + "\n");
}
console.log("Prepared three local Vercel configurations. No deployment performed; set public build origins as documented.");
