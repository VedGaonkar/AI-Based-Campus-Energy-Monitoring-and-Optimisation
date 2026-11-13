import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomInt } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import bcrypt from "bcrypt";
import { readServerEnvironment, loadConfig } from "../backend/src/config.js";
import { connectDatabase } from "../backend/src/models/index.js";
import { createApplication } from "../backend/src/app.js";
import { startDatabase } from "../scripts/database.mjs";

const key = () => randomInt(10000000, 100000000).toString();
test("environment files reload without parent-process mutation; explicit process environment wins", async () => {
  const dir = await mkdtemp(join(tmpdir(), "campus-env-")), path = join(dir, ".env");
  const first = key(); let second; do { second = key(); } while (second === first);
  const parent = process.env.ADMIN_INVITE_KEY;
  try {
    await writeFile(path, `ADMIN_INVITE_KEY=${first}\n`);
    const original = readServerEnvironment({}, path);
    await writeFile(path, `ADMIN_INVITE_KEY=${second}\n`);
    assert.ok(original.ADMIN_INVITE_KEY === first, "Existing config must remain a startup snapshot");
    assert.ok(readServerEnvironment({}, path).ADMIN_INVITE_KEY === second, "Fresh load must read changed file");
    assert.ok(readServerEnvironment({ ADMIN_INVITE_KEY: first }, path).ADMIN_INVITE_KEY === first, "Explicit deployment variable must win");
    assert.equal(readServerEnvironment({ ADMIN_INVITE_KEY: "" }, path).ADMIN_INVITE_KEY, "");
    assert.ok(process.env.ADMIN_INVITE_KEY === parent, "File loader must not mutate inherited environment");
    await writeFile(path, ""); assert.equal(readServerEnvironment({}, path).ADMIN_INVITE_KEY, undefined);
    await writeFile(path, `ADMIN_INVITE_KEY=${first}\nADMIN_INVITE_KEY=${second}\n`);
    assert.throws(() => readServerEnvironment({}, path), /Duplicate ADMIN_INVITE_KEY/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("fresh application key rotation rejects previous keys, disables missing enrollment and preserves existing login", async () => {
  const database = await startDatabase();
  const { connection, models } = await connectDatabase(database.getUri("admin_rotation"));
  const password = randomBytes(20).toString("hex"), first = key(); let second; do { second = key(); } while (second === first);
  const env = { NODE_ENV: "test", SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), PUBLIC_APP_URL: "http://localhost:5000" };
  const passwordHash = await bcrypt.hash(password, 4);
  await models.User.create({ _id: "existing-admin", email: "existing@rotation.test", role: "admin", active: true, name: "Existing", passwordHash, permittedRoomIds: ["unchanged-room"] });
  await models.User.create({ _id: "inactive-user", email: "inactive@rotation.test", role: "viewer", active: false, name: "Inactive", passwordHash });
  // A stored installation label or old arbitrary setting must not become auth configuration.
  await models.Settings.create({ _id: "installation", installationName: "Rotation test" });
  await connection.collection("settings").updateOne({ _id: "installation" }, { $set: { adminInviteKey: first } });
  let runtime;
  async function send(path, body, agent = request.agent(runtime.app)) {
    const token = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
    return agent.post(`/api/v1/auth/${path}`).set("Origin", env.PUBLIC_APP_URL).set("X-CSRF-Token", token).send(body);
  }
  const register = (submitted, suffix) => send("register", { name: "Candidate", email: `${suffix}@rotation.test`, password, adminKey: submitted });
  try {
    runtime = createApplication({ connection, models, config: loadConfig({ ...env, ADMIN_INVITE_KEY: first }) });
    const good = await register(first, "first"); assert.equal(good.status, 201); assert.equal(good.body.data.user.role, "admin");
    assert.equal((await register(second, "wrong")).status, 403);
    assert.equal(await models.User.countDocuments({ email: "wrong@rotation.test" }), 0);
    await runtime.close();
    runtime = createApplication({ connection, models, config: loadConfig({ ...env, ADMIN_INVITE_KEY: second }) });
    assert.equal((await register(first, "old-key")).status, 403);
    const rotated = await register(second, "second"); assert.equal(rotated.status, 201);
    const oldLogin = await send("login", { email: "existing@rotation.test", password, adminKey: first }); assert.equal(oldLogin.status, 403);
    const agent = request.agent(runtime.app);
    const login = await send("login", { email: "existing@rotation.test", password, adminKey: second }, agent); assert.equal(login.status, 200);
    for (const path of ["/auth/me", "/settings", "/rooms", "/health", "/audit-events"]) {
      const response = await agent.get(`/api/v1${path}`);
      const json = JSON.stringify(response.body);
      assert.ok(!json.includes(first) && !json.includes(second), "Normal response must not contain either secret");
    }
    assert.ok(!JSON.stringify(rotated.body).includes(second), "Registration response must not contain invitation secret");
    await runtime.close();
    runtime = createApplication({ connection, models, config: loadConfig(env) });
    const missing = await register(first, "missing"); assert.equal(missing.status, 503); assert.equal(missing.body.error.code, "ADMIN_ACCESS_DISABLED");
    assert.ok(missing.body.error.message.includes("ADMIN_INVITE_KEY"));
    const existing = await send("login", { email: "existing@rotation.test", password }); assert.equal(existing.status, 200); assert.equal(existing.body.data.user.role, "admin");
    assert.equal((await send("login", { email: "inactive@rotation.test", password, adminKey: first })).status, 401);
    const unchanged = await models.User.findById("existing-admin").lean(); assert.deepEqual(unchanged.permittedRoomIds, ["unchanged-room"]);
    const rejected = [];
    for (let i = 0; i < 51; i++) rejected.push((await register(first, `throttle-${i}`)).status);
    assert.ok(rejected.includes(429), "Enrollment throttling must apply even to demo localhost requests");
  } finally { await runtime?.close(); await connection.close(); await database.stop(); }
});
