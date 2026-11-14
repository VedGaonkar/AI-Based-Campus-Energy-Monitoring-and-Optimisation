import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import request from "supertest";
import { startDatabase } from "../scripts/database.mjs";
import { loadConfig } from "../backend/src/config.js";
import { createInstitutionApplication } from "../backend/src/workspaces/runtime.js";
import { joinLookup, withJoinLock } from "../backend/src/workspaces/join-code.js";
let db, runtime, directory, admin, viewer, other;
const origin = "http://localhost:5000", password = randomBytes(3).toString("hex"), adminKey = randomBytes(24).toString("hex");
const code = () => { let v; do { v = randomBytes(6).toString("base64url"); } while (!/[A-Za-z]/.test(v) || !/[0-9]/.test(v) || new Set(v).size < 6); return v; };
let currentCode = code();
async function guest() { const agent = request.agent(runtime.app); return { agent, csrf: (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken }; }
const write = (who, path, body, method = "post") => who.agent[method](`/api/v1${path}`).set("Origin", origin).set("X-CSRF-Token", who.csrf).send(body);
const body = (email, joinCode = currentCode, accountType = "viewer", extra = {}) => ({ name: "Test member", email, password, confirmPassword: password, accountType, joinCode, ...(accountType === "administrator" ? { institutionName: "Preserved building", adminKey } : {}), ...extra });
async function register(input) { const g = await guest(), response = await write(g, "/auth/register", input); return { ...g, response, csrf: response.body.data?.csrfToken ?? g.csrf, user: response.body.data?.user, id: response.body.data?.institution?._id }; }
before(async () => { db = await startDatabase(); runtime = await createInstitutionApplication(loadConfig({ NODE_ENV: "test", ADMIN_INVITE_KEY: adminKey, MONGODB_URI: db.getUri("building_auth"), SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), FRONTEND_ORIGIN: origin, PUBLIC_APP_URL: origin })); directory = runtime.directory; });
after(async () => { await runtime?.close(); await db?.stop(); });
test("Administrator requires the configured creation key and creates an empty immutable building", async () => {
 const g = await guest(), candidate = body("rejected@building.test", currentCode, "administrator");
 for (const supplied of [undefined, "incorrect-registration-key"]) { const response = await write(g, "/auth/register", { ...candidate, adminKey: supplied }); assert.equal(response.status, 403); }
 const configured = directory.config.adminInviteKey; directory.config.adminInviteKey = null;
 try { assert.equal((await write(g, "/auth/register", candidate)).status, 503); } finally { directory.config.adminInviteKey = configured; }
 assert.equal(await directory.Account.countDocuments(), 0); assert.equal(await directory.Institution.countDocuments(), 0);
 admin = await register(body("admin@building.test", currentCode, "administrator")); assert.equal(admin.response.status, 201); assert.equal(admin.user.role, "admin"); assert.equal(admin.user.institutionId, admin.id);
 for (const path of ["/rooms", "/devices", "/meter-readings", "/incidents", "/recommendations", "/connected-devices"]) assert.deepEqual((await admin.agent.get(`/api/v1${path}`)).body.data, []);
 assert.deepEqual((await admin.agent.get("/api/v1/settings")).body.data.meters, []);
 const raw = await directory.Institution.findById(admin.id).select("+joinCodeLookup +joinCodeVerifier").lean(); assert.notEqual(raw.joinCodeVerifier, currentCode); assert.ok(await bcrypt.compare(currentCode, raw.joinCodeVerifier)); assert.equal(raw.joinCodeLookup, joinLookup(currentCode, directory.config));
});
test("correct Viewer code resolves building; invalid code leaves no identity or membership", async () => {
 const count = await directory.Account.countDocuments(), members = await directory.Membership.countDocuments();
 assert.equal((await register(body("invalid@building.test", code()))).response.status, 403); assert.equal(await directory.Account.countDocuments(), count); assert.equal(await directory.Membership.countDocuments(), members);
 viewer = await register(body("viewer@building.test")); assert.equal(viewer.response.status, 201); assert.equal(viewer.id, admin.id); assert.equal(viewer.user.role, "viewer"); assert.equal(viewer.user.institution.displayName, "Preserved building");
 assert.equal((await viewer.agent.get("/api/v1/management/building")).status, 403); assert.equal((await write(viewer, "/institutions/current/join-code", { joinCode: code() }, "put")).status, 403);
});
test("both existing roles sign in with password only without changing hashes or memberships", async () => {
 for (const who of [admin, viewer]) { const original = await directory.Account.findById(who.user._id).select("+passwordHash").lean(), g = await guest(), result = await write(g, "/auth/login", { email: who.user.email, password }); assert.equal(result.status, 200); assert.equal(result.body.data.user.role, who.user.role); assert.equal(result.body.data.user._id, who.user._id); assert.equal((await directory.Account.findById(who.user._id).select("+passwordHash").lean()).passwordHash, original.passwordHash); assert.equal(await directory.Membership.countDocuments({ userId: who.user._id }), 1); }
});
test("codes uniquely resolve despite concurrent writes; matching names never grant existing admin access", async () => {
 const count = await directory.Account.countDocuments(), buildings = await directory.Institution.countDocuments(); assert.equal((await register(body("duplicate@building.test", currentCode, "administrator"))).response.status, 409); assert.equal(await directory.Account.countDocuments(), count); assert.equal(await directory.Institution.countDocuments(), buildings);
 other = await register(body("other@building.test", code(), "administrator")); assert.equal(other.response.status, 201); assert.notEqual(other.id, admin.id); assert.equal(await directory.Membership.countDocuments({ userId: other.user._id, institutionId: admin.id }), 0);
 const shared = code(), results = await Promise.all([write(admin, "/institutions/current/join-code", { joinCode: shared }, "put"), write(other, "/institutions/current/join-code", { joinCode: shared }, "put")]); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal(await directory.Institution.countDocuments({ joinCodeLookup: joinLookup(shared, directory.config) }), 1);
 currentCode = code(); assert.equal((await write(admin, "/institutions/current/join-code", { joinCode: currentCode }, "put")).status, 200);
});
test("rotation/disable reject old admissions, preserve members and survive rename", async () => {
 const old = currentCode; currentCode = code(); assert.equal((await write(admin, "/institutions/current/join-code", { joinCode: currentCode }, "put")).status, 200); assert.equal((await register(body("old@building.test", old))).response.status, 403);
 assert.equal((await write(admin, "/institutions/current", { displayName: "Renamed building" }, "patch")).status, 200); const joined = await register(body("new@building.test")); assert.equal(joined.response.status, 201); assert.equal(joined.id, admin.id); assert.equal(joined.user.institution.displayName, "Renamed building");
 assert.equal((await write(admin, "/institutions/current/join-code", { enabled: false }, "put")).status, 200); assert.equal((await register(body("disabled@building.test"))).response.status, 403); assert.equal((await viewer.agent.get("/api/v1/auth/me")).status, 200);
 const g = await guest(); assert.equal((await write(g, "/auth/login", { email: viewer.user.email, password })).status, 200); assert.equal((await write(admin, "/institutions/current/join-code", { joinCode: currentCode }, "put")).status, 200);
});
test("admission and rotation use the same persistent lock and stale code cannot admit afterwards", async () => {
 let release, entered; const ready = new Promise(r => { entered = r; }), gate = new Promise(r => { release = r; }); const held = withJoinLock(directory, admin.id, async () => { entered(); await gate; }); await ready;
 let completed = false; const next = code(), rotation = write(admin, "/institutions/current/join-code", { joinCode: next }, "put").then(r => { completed = true; return r; }); await new Promise(r => setTimeout(r, 350)); assert.equal(completed, false); release(); await held; assert.equal((await rotation).status, 200);
 assert.equal((await register(body("race-old@building.test", currentCode))).response.status, 403); currentCode = next;
});
test("membership persistence failure rolls back only new identity and retains all existing members", async () => {
 const original = directory.addMember, count = await directory.Account.countDocuments(), realm = await directory.realm(admin.id); directory.addMember = async (...args) => { await original(...args); throw new Error("Injected isolated membership failure"); };
 try { assert.equal((await register(body("rollback@building.test"))).response.status, 500); } finally { directory.addMember = original; }
 assert.equal(await directory.Account.countDocuments(), count); assert.equal(await realm.models.User.countDocuments({ email: "rollback@building.test" }), 0); assert.equal(await directory.Membership.countDocuments({ userId: viewer.user._id, institutionId: admin.id }), 1);
});
test("strict validation rejects weak code, password mismatch and role/building injection", async () => {
 const g = await guest(), count = await directory.Account.countDocuments(); for (const input of [body("bad@building.test", "weak"), body("bad@building.test", currentCode, "viewer", { confirmPassword: `${password}x` }), body("bad@building.test", currentCode, "viewer", { role: "admin" }), body("bad@building.test", currentCode, "viewer", { institutionId: other.id })]) assert.equal((await write(g, "/auth/register", input)).status, 400);
 assert.equal(await directory.Account.countDocuments(), count); assert.equal((await write(viewer, "/auth/select-workspace", { institutionId: other.id })).status, 403);
});
test("normal APIs and audit records never expose code, verifier or lookup", async () => {
 const raw = await directory.Institution.findById(admin.id).select("+joinCodeLookup +joinCodeVerifier").lean(); for (const path of ["/auth/me", "/institutions/current", "/auth/workspaces", "/settings", "/audit-events"]) { const json = JSON.stringify((await admin.agent.get(`/api/v1${path}`)).body); for (const secret of [currentCode, raw.joinCodeLookup, raw.joinCodeVerifier, adminKey]) assert.ok(!json.includes(secret)); }
});
test("anonymous bootstrap and sign-out revoke cookie and allow fresh password login", async () => {
 const visitor = await guest(), initial = await visitor.agent.get("/api/v1/auth/session"); assert.equal(initial.status, 200); assert.equal(initial.body.data.user, null);
 const logged = await write(visitor, "/auth/login", { email: viewer.user.email, password }); assert.equal(logged.status, 200); visitor.csrf = logged.body.data.csrfToken;
 const cookie = logged.headers["set-cookie"].map(v => v.split(";")[0]).join("; ");
 assert.equal((await write(visitor, "/auth/logout", {})).status, 200); assert.equal((await visitor.agent.get("/api/v1/auth/me")).status, 401);
 assert.equal((await request(runtime.app).get("/api/v1/rooms").set("Cookie", cookie)).status, 401);
 const fresh = await visitor.agent.get("/api/v1/auth/session"); assert.equal(fresh.status, 200); assert.equal(fresh.body.data.user, null); assert.notEqual(fresh.body.data.csrfToken, visitor.csrf);
 visitor.csrf = fresh.body.data.csrfToken; assert.equal((await write(visitor, "/auth/login", { email: viewer.user.email, password })).status, 200);
 assert.equal((await write(admin, "/users", { name: "Six-character staff", email: "staff@building.test", password, role: "viewer", permittedRoomIds: [] })).status, 201);
});
test("local/demo registration code guesses are throttled without creating accounts", async () => {
 const g = await guest(); let limited = false; for (let i = 0; i < 22; i++) { const response = await write(g, "/auth/register", body(`guess-${i}@building.test`, code())); if (response.status === 429) { limited = true; break; } } assert.equal(limited, true); assert.equal(await directory.Account.countDocuments({ email: /^guess-/ }), 0);
});
