import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parse } from "dotenv";

const root = new URL("../", import.meta.url);
const target = new URL(".env", root);
if (process.argv.includes("--enable-demo") && process.env.NODE_ENV === "production") throw new Error("Local demo credential generation is disabled in production; provision server environment credentials explicitly.");
if (existsSync(target)) {
  console.log("Existing .env preserved. Account registration is managed in the application.");
} else {
  const content = readFileSync(new URL(".env.example", root), "utf8")
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
if (process.argv.includes("--enable-demo")) {
  let content = readFileSync(target, "utf8"); const existing = parse(content);
  const values = { ENABLE_DEMO_SETUP: "true", DEMO_ADMIN_EMAIL: "showcase.admin@campus.example", DEMO_VIEWER_EMAIL: "showcase.viewer@campus.example", DEMO_ADMIN_PASSWORD: randomBytes(24).toString("base64url"), DEMO_VIEWER_PASSWORD: randomBytes(24).toString("base64url") };
  for (const [name, value] of Object.entries(values)) if (name === "ENABLE_DEMO_SETUP" || !existing[name]) {
    const line = new RegExp(`^${name}=.*$`, "m"); content = line.test(content) ? content.replace(line, `${name}=${value}`) : `${content.trimEnd()}\n${name}=${value}\n`;
  }
  writeFileSync(target, content, { mode: 0o600 });
  console.log("Explicit local demo enabled; missing dedicated credentials generated only in ignored .env. Existing passwords preserved; run npm run seed explicitly. Values withheld.");
}
