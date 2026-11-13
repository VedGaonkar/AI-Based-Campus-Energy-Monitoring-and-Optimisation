import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const target = new URL(".env", root);
if (existsSync(target)) {
  console.log("Existing .env preserved. Review its configuration locally.");
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
