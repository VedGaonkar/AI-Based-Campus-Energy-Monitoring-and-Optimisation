import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomInt } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const target = new URL(".env", root);
const generateAdminKey = () => randomInt(10000000, 100000000).toString();
if (existsSync(target)) {
  if (process.argv.includes("--generate-admin-key")) {
    const existing = readFileSync(target, "utf8"), line = `ADMIN_INVITE_KEY=${generateAdminKey()}`;
    const retained = existing.replace(/^\s*(?:export\s+)?ADMIN_INVITE_KEY\s*=.*\r?\n?/gm, "");
    writeFileSync(target, `${retained.trimEnd()}\n${line}\n`, { mode: 0o600 });
    console.log("Generated a new ADMIN_INVITE_KEY in the ignored .env. Other settings preserved. Restart the API and use the key from that file; its value was not printed.");
  } else console.log("Existing .env preserved. Review its configuration locally. To generate a new admin key explicitly: npm run setup -- --generate-admin-key");
} else {
  const content = readFileSync(new URL(".env.example", root), "utf8")
    .replace(/^ADMIN_INVITE_KEY=.*$/m, `ADMIN_INVITE_KEY=${generateAdminKey()}`)
    .replace("replace_with_generated_secret", randomBytes(32).toString("hex"))
    .replace(
      "replace_with_separate_generated_secret",
      randomBytes(32).toString("hex"),
    )
    .replace(
      "replace_with_local_demo_password",
      randomBytes(18).toString("base64url"),
    );
  writeFileSync(target, content, { mode: 0o600, flag: "wx" });
  console.log(
    `Created ignored local configuration at ${fileURLToPath(target)}. Secrets were not printed.`,
  );
}
