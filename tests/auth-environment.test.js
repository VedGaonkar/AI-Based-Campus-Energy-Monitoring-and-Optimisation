import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { readServerEnvironment } from "../backend/src/config.js";
const key = () => randomBytes(32).toString("hex");
test("environment files reload without parent-process mutation; explicit process environment wins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "campus-env-")), path = join(dir, ".env");
  const first = key(); let second; do { second = key(); } while (second === first);
  const parent = process.env.SESSION_SECRET;
  try {
    await writeFile(path, `SESSION_SECRET=${first}\n`);
    const original = readServerEnvironment({}, path);
    await writeFile(path, `SESSION_SECRET=${second}\n`);
    assert.ok(original.SESSION_SECRET === first, "Existing config must remain a startup snapshot");
    assert.ok(readServerEnvironment({}, path).SESSION_SECRET === second, "Fresh load must read changed file");
    assert.ok(readServerEnvironment({ SESSION_SECRET: first }, path).SESSION_SECRET === first, "Explicit deployment variable must win");
    assert.equal(readServerEnvironment({ SESSION_SECRET: "" }, path).SESSION_SECRET, "");
    assert.ok(process.env.SESSION_SECRET === parent, "File loader must not mutate inherited environment");
    await writeFile(path, ""); assert.equal(readServerEnvironment({}, path).SESSION_SECRET, undefined);
  } finally { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(basename(dir).startsWith("campus-env-")); await rm(dir, { recursive: true, force: true }); }
});
