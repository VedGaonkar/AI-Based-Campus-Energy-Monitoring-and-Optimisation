import { readdir, readFile } from "node:fs/promises";
import { loadConfig } from "../backend/src/config.js";
const config = loadConfig();
async function files(path) {
  return (await Promise.all((await readdir(path, { withFileTypes: true })).map(entry => entry.isDirectory() ? files(`${path}/${entry.name}`) : `${path}/${entry.name}`))).flat();
}
const paths = [...await files("frontend/dist"), ...await files("demo")].filter(path => /\.(?:js|css|html|json|map)$/.test(path));
const secrets = [config.adminInviteKey, config.sessionSecret, config.ingestToken, config.demoPassword].filter(Boolean);
for (const path of paths) {
  const content = await readFile(path, "utf8");
  if (secrets.some(secret => content.includes(secret))) throw new Error("A server secret appears in client assets; release blocked. Secret value withheld.");
  if (/(?:VITE|NEXT_PUBLIC|PUBLIC)_ADMIN_INVITE_KEY/.test(content)) throw new Error("Public invitation-key configuration found; release blocked.");
}
console.log(`Secret scan passed for ${paths.length} built frontend/demo assets. No credential values printed.`);
