import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { loadConfig } from "../backend/src/config.js";
const env = () => ({
  SESSION_SECRET: randomBytes(32).toString("hex"),
  SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"),
  NODE_ENV: "test",
});
test("startup rejects physical enablement and unsupported physical adapters", () => {
  assert.throws(
    () => loadConfig({ ...env(), ALLOW_PHYSICAL_CONTROL: "true" }),
    /physical control must remain disabled/,
  );
  assert.throws(() =>
    loadConfig({ ...env(), DEVICE_ADAPTER: "vendor-not-commissioned" }),
  );
});
test("accelerated clocks cannot be configured outside demo mode", () => {
  assert.throws(
    () => loadConfig({ ...env(), DEMO_MODE: "false", DEMO_TIME_SCALE: "60" }),
    /restricted to demo/,
  );
  assert.equal(
    loadConfig({ ...env(), DEMO_MODE: "false", DEMO_TIME_SCALE: "1" })
      .timeScale,
    1,
  );
});
test("startup rejects placeholder and short session/ingest credentials", () => {
  assert.throws(() =>
    loadConfig({ ...env(), SESSION_SECRET: "replace_with_generated_secret" }),
  );
  assert.throws(() => loadConfig({ ...env(), SERVICE_INGEST_TOKEN: "short" }));
});

test("administrator key requires exactly eight digits while other secret requirements stay unchanged", () => {
  assert.equal(loadConfig({ ...env(), ADMIN_INVITE_KEY: "01234567" }).adminInviteKey, "01234567");
  assert.equal(loadConfig({ ...env(), ADMIN_INVITE_KEY: "" }).adminInviteKey, null);
  for (const value of ["1234567", "123456789", "abcdefgh", "1234abcd", "1234567890123456"])
    assert.throws(() => loadConfig({ ...env(), ADMIN_INVITE_KEY: value }));
});
