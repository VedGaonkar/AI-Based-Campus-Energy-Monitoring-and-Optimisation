import { readdir, readFile } from "node:fs/promises";
import { loadConfig } from "../backend/src/config.js";
const config = loadConfig();
async function files(path) {
  return (await Promise.all((await readdir(path, { withFileTypes: true })).map(entry => entry.isDirectory() ? files(`${path}/${entry.name}`) : `${path}/${entry.name}`))).flat();
}
const paths = [...await files("frontend/dist"), ...await files("dist"), ...await files("demo")].filter(path => /\.(?:js|css|html|json|map)$/.test(path));
const secrets = [config.adminInviteKey, config.sessionSecret, config.ingestToken, config.demoPassword, config.demoAdminPassword, config.demoViewerPassword].filter(Boolean);
for (const path of paths) {
  const content = await readFile(path, "utf8");
  // Complete, fixed vendor encoding alphabets contain every consecutive digit.
  // Remove only these exact constants, not arbitrary numeric matches: an actual
  // configured credential literal elsewhere must still fail the scan.
  const searchable = content
    .replaceAll("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", "")
    .replaceAll("ModuleSymbhasOwnPr-0123456789ABCDEFGHNRVfgctiUvz_KqYTJkLxpZXIjQW", "");
  if (secrets.some(secret => searchable.includes(secret))) throw new Error("A server secret appears in client assets; release blocked. Secret value withheld.");
}
console.log(`Secret scan passed for ${paths.length} built frontend/demo assets. No credential values printed.`);
