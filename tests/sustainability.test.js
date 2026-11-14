import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import request from "supertest";
import { defaults, assumedFactor, officialFactor, periodSummary, buildSustainability } from "../backend/src/domain/sustainability.js";
import { startDatabase } from "../scripts/database.mjs";
import { loadConfig } from "../backend/src/config.js";
import { createInstitutionApplication } from "../backend/src/workspaces/runtime.js";
const hour = 3600000, origin = "http://localhost:5173";
const selection = { meterId: "MAIN-01", dataMode: "live", baselineStart: "2025-05-01T00:00:00.000Z", baselineEnd: "2025-05-01T02:00:00.000Z", start: "2025-05-02T00:00:00.000Z", end: "2025-05-02T02:00:00.000Z", occupancy: "similar", contextEvidence: "Attendance registers match both periods" };
const interval = (start, value, hours = 1) => ({ meterId: "MAIN-01", dataMode: "live", startAt: new Date(start), endAt: new Date(+new Date(start) + hours * hour), durationHours: hours, energyKwh: value, sourceTypes: ["manual"], sourceReadingIds: [], coverage: hours > 1.05 ? "gap_aggregate" : "interval" });
const intervals = [interval(selection.baselineStart, 10), interval("2025-05-01T01:00:00Z", 10), interval(selection.start, 8), interval("2025-05-02T01:00:00Z", 8)];
const schedules = [selection.baselineStart, selection.start].map(startAt => ({ startAt, endAt: new Date(+new Date(startAt) + 2 * hour), status: "confirmed" }));
const calculate = extra => buildSustainability({ intervals, selection, schedules, factors: [assumedFactor], config: { ...defaults, enabled: true }, ...extra });
test("kWh to kg CO2 uses the applicable factor, retains units and reports observed reduction", () => {
  const result = calculate({ tariff: 8 }); assert.equal(result.current.kwh, 16); assert.equal(result.current.estimatedKgCO2, 10.8); assert.equal(result.reductionPercent, 20); assert.equal(result.monetary.observedDifferenceEstimate, 32); assert.match(result.recognition, /Recorded electricity use decreased/); assert.equal(result.factors[0].verificationStatus, "user-specified assumption"); assert.equal(result.methodology.version, "internal-sustainability-1");
});
test("zero, missing and unequal baselines never create an invented reduction", () => {
  assert.equal(calculate({ intervals: intervals.map((r, i) => i < 2 ? { ...r, energyKwh: 0 } : r) }).reductionPercent, null);
  assert.equal(calculate({ intervals: intervals.slice(2) }).baseline.kwh, null);
  assert.equal(calculate({ intervals: intervals.slice(2) }).reductionPercent, null);
  assert.equal(calculate({ selection: { ...selection, baselineEnd: "2025-05-01T01:00:00Z" } }).reductionPercent, null);
});
test("increases remain negative reductions; open, gapped, simulation and changed occupancy block recognition", () => {
  const up = calculate({ intervals: intervals.map((r, i) => i >= 2 ? { ...r, energyKwh: 15 } : r) }); assert.equal(up.reductionPercent, -50); assert.equal(up.trend, "Recorded increase"); assert.equal(up.recognition, null);
  const gap = calculate({ intervals: [...intervals.slice(0, 2), interval(selection.start, 8, 2)] }); assert.equal(gap.current.kwh, 8); assert.equal(gap.current.regularCoveragePercent, 0); assert.equal(gap.recognition, null); assert.match(gap.current.gaps[0].kind, /aggregate/);
  assert.equal(calculate({ now: new Date(selection.start) }).recognition, null);
  assert.equal(calculate({ intervals: intervals.slice(0, 3) }).current.regularCoveragePercent, 50);
  assert.equal(calculate({ selection: { ...selection, dataMode: "simulated" } }).recognition, null);
  assert.equal(calculate({ selection: { ...selection, occupancy: "different" } }).recognition, null);
  assert.equal(calculate({ schedules: schedules.slice(0, 1) }).recognition, null);
});
test("factor revisions apply by interval, missing coverage stays unavailable and boundary intervals are not prorated", () => {
  const old = { ...assumedFactor, _id: "old", revision: 1, value: 1 }, newer = { ...assumedFactor, _id: "new", revision: 2, value: 0.5, effectiveFrom: selection.start };
  const r = calculate({ factors: [old, newer] }); assert.equal(r.baseline.estimatedKgCO2, 20); assert.equal(r.current.estimatedKgCO2, 8);
  assert.equal(periodSummary([interval(selection.start, 8)], selection.start, selection.end, [{ ...newer, effectiveFrom: "2025-05-02T00:30:00Z" }, old]).estimatedKgCO2, null);
  assert.equal(calculate({ factors: [] }).current.estimatedKgCO2, null);
  const missing = calculate({ factors: [{ ...newer, effectiveFrom: "2025-05-02T01:00:00Z" }] }); assert.equal(missing.current.estimatedKgCO2, null); assert.equal(missing.current.partialKnownKgCO2, 4);
  assert.equal(periodSummary([interval("2025-05-01T23:00:00Z", 5, 2)], selection.start, selection.end, [old]).intervalCount, 0);
  assert.equal(officialFactor.unit, "kg CO2/kWh"); assert.match(officialFactor.methodology, /weighted average/);
});
test("social formula uses evidenced approval and denominators; governance missing inputs mean not recorded", () => {
  const approved = { _id: "a", kind: "activity", date: selection.start, status: "approved", evidence: "Attendance register", countingMethod: "unique_within_activity", students: 20, staff: 5, denominator: 50 };
  const result = calculate({ records: [approved, { ...approved, _id: "b", status: "pending" }, { ...approved, _id: "c", countingMethod: "attendance" }] });
  assert.equal(result.social.score, 50); assert.equal(result.social.numerator, 25); assert.equal(result.social.denominator, 50); assert.equal(result.social.approvedActivityCount, 2);
  assert.equal(result.governance.score, 25); assert.equal(result.governance.rubric[0].status, "not recorded");
  const policy = { _id: "p", kind: "policy", date: selection.start, endAt: selection.end, reviewAt: selection.start, evidence: "Policy record", status: "approved" };
  assert.equal(calculate({ records: [policy, { ...policy, _id: "report", kind: "reporting" }] }).governance.score, 100);
  assert.equal(calculate({ records: [{ ...approved, denominator: 0 }] }).social.score, null);
});

let db, runtime, a, b, viewer, realm;
const password = randomBytes(18).toString("hex"), key = randomBytes(18).toString("hex");
const write = (member, method, path, body) => member.agent[method](`/api/v1/sustainability${path}`).set("Origin", origin).set("X-CSRF-Token", member.csrf).send(body);
async function register(name) { const agent = request.agent(runtime.app), csrf = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken; const r = await agent.post("/api/v1/auth/register").set("Origin", origin).set("X-CSRF-Token", csrf).send({ name, email: `${name}@esg.test`, password, confirmPassword: password, accountType: "administrator", institutionName: name, adminKey: key, joinCode: `Join-${randomBytes(10).toString("hex")}` }); assert.equal(r.status, 201); return { agent, csrf: r.body.data.csrfToken, id: r.body.data.institution._id, user: r.body.data.user }; }
before(async () => {
  db = await startDatabase(); runtime = await createInstitutionApplication(loadConfig({ NODE_ENV: "test", MONGODB_URI: db.getUri("sustainability_test"), SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), ADMIN_INVITE_KEY: key, FRONTEND_ORIGIN: origin }));
  a = await register("alpha"); b = await register("beta"); realm = await runtime.directory.realm(a.id);
  for (const member of [a, b]) await (await runtime.directory.realm(member.id)).models.Settings.updateOne({ _id: "installation" }, { $set: { meters: [{ meterId: "MAIN-01", epoch: "initial", register: "import_kwh", maxPowerKw: 100 }] } });
  const account = await runtime.directory.Account.create({ name: "Viewer", email: "viewer@esg.test", passwordHash: (await runtime.directory.Account.findById(a.user._id).select("+passwordHash").lean()).passwordHash, active: true }); await runtime.directory.addMember(realm, account, { role: "viewer" });
  const agent = request.agent(runtime.app), csrf = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken; const login = await agent.post("/api/v1/auth/login").set("Origin", origin).set("X-CSRF-Token", csrf).send({ email: account.email, password }); assert.equal(login.status, 200); viewer = { agent, csrf: login.body.data.csrfToken };
  for (const r of intervals) await realm.models.MeterReading.create({ importKey: randomUUID(), meterId: "MAIN-01", epoch: "initial", kind: "interval", register: "import_kwh", unit: "kWh", value: r.energyKwh, intervalStart: r.startAt, capturedAt: r.endAt, sourceType: "manual", validationState: "accepted", dataMode: "live" });
});
after(async () => { await runtime?.close(); await db?.stop(); });
test("module opt-in and writes require administrator; viewers cannot forge factors, evidence approval or export", async () => {
  assert.equal((await write(a, "post", "/preview", selection)).status, 409);
  assert.equal((await write(viewer, "patch", "/config", { enabled: true, reductionThreshold: 5, minimumCoverage: 90 })).status, 403);
  assert.equal((await write(a, "patch", "/config", { enabled: true, reductionThreshold: 5, minimumCoverage: 90 })).status, 200);
  for (const path of ["/factors", "/records", "/reports", "/records/no-id/review"]) assert.equal((await write(viewer, "post", path, {})).status, 403);
  assert.equal((await viewer.agent.get("/api/v1/sustainability/reports/anything/export")).status, 403);
  assert.equal((await write(viewer, "post", "/preview", selection)).status, 200);
  assert.equal((await write(a, "post", "/preview", { ...selection, institutionId: b.id })).status, 400);
  assert.equal((await write(a, "post", "/preview", { ...selection, start: selection.baselineStart })).status, 400);
  assert.equal((await write(a, "post", "/preview", { ...selection, occupancy: "similar", contextEvidence: "" })).status, 400);
});
test("pending evidence excluded until reviewed; invalid denominators and custom verification claims are rejected", async () => {
  const body = { kind: "activity", title: "Switch off campaign", date: selection.start, responsible: "Energy officer", evidence: "Register reference E-1", students: 20, staff: 5, denominator: 50, countingMethod: "unique_within_activity" };
  assert.equal((await write(a, "post", "/records", { ...body, denominator: 1 })).status, 400);
  const created = await write(a, "post", "/records", body); assert.equal(created.status, 201);
  assert.equal((await viewer.agent.get("/api/v1/sustainability/records")).body.data.length, 0);
  assert.equal((await write(a, "post", "/preview", selection)).body.data.social.score, null);
  assert.equal((await write(a, "post", `/records/${created.body.data._id}/review`, { status: "approved", note: "Checked attendance evidence" })).status, 200);
  assert.equal((await write(viewer, "post", "/preview", selection)).body.data.social.score, 50);
  assert.equal((await write(a, "post", "/factors", { ...officialFactor, verificationStatus: "official source checked" })).status, 400);
  assert.equal((await write(a, "post", "/factors", { officialIndiaFY2025: true })).status, 201);
});
test("saved exports preserve factor history, inputs and building identity after later corrections/config changes", async () => {
  const before = (await write(a, "post", "/preview", selection)).body.data; assert.equal(before.current.kwh, 16); assert.equal(before.current.estimatedKgCO2, 10.8);
  const saved = await write(a, "post", "/reports", selection); assert.equal(saved.status, 201); const row = saved.body.data;
  assert.equal(row.payload.sha256, createHash("sha256").update(JSON.stringify(row.payload.snapshot)).digest("hex")); assert.equal(row.payload.snapshot.institution.id, a.id); assert.equal(row.payload.snapshot.sourceReadings.length, 4);
  const factor = { value: 1, geography: "Local assumption", reportingYear: "2025", source: "User assumption", methodology: "Test consumption assumption", effectiveFrom: selection.baselineStart, effectiveTo: selection.end };
  assert.equal((await write(a, "post", "/factors", factor)).status, 201);
  assert.equal((await write(a, "post", "/preview", selection)).body.data.current.estimatedKgCO2, 16);
  await realm.models.MeterReading.updateOne({ intervalStart: new Date(selection.start) }, { $set: { value: 9 } });
  assert.equal((await write(a, "post", "/preview", selection)).body.data.current.kwh, 17);
  const exported = await a.agent.get(`/api/v1/sustainability/reports/${row._id}/export`); assert.equal(exported.status, 200); assert.deepEqual(exported.body.data.payload, row.payload);
  assert.match(exported.headers["content-disposition"], /attachment/);
  assert.equal((await write(b, "patch", "/config", { enabled: true, reductionThreshold: 5, minimumCoverage: 90 })).status, 200);
  assert.equal((await b.agent.get(`/api/v1/sustainability/reports/${row._id}/export`)).status, 404);
  assert.equal((await write(b, "post", "/preview", selection)).body.data.current.kwh, null);
  assert.equal((await b.agent.get("/api/v1/sustainability/factors")).body.data.length, 1);
  assert.equal((await a.agent.get("/api/v1/sustainability/factors")).body.data.length, 3);
});
test("source unit and acceptance are enforced without treating missing readings as measured", async () => {
  await realm.models.MeterReading.create({ importKey: randomUUID(), meterId: "MAIN-01", epoch: "initial", kind: "interval", register: "import_kwh", unit: "kWh", value: 99, intervalStart: new Date(selection.start), capturedAt: new Date("2025-05-02T00:30:00Z"), sourceType: "ocr", validationState: "needs_review", dataMode: "live" });
  const result = (await write(a, "post", "/preview", selection)).body.data; assert.equal(result.current.kwh, 17); assert.equal(result.quality.unacceptedReadings, 1); assert.equal(result.recognition, null);
  await realm.models.MeterReading.updateOne({ capturedAt: new Date("2025-05-02T01:00:00Z"), validationState: "accepted" }, { $set: { unit: "kW" } });
  const bad = (await write(a, "post", "/preview", selection)).body.data; assert.equal(bad.current.kwh, 8); assert.equal(bad.current.regularCoveragePercent, 50); assert.equal(bad.quality.invalidUnitOrValueReadings, 1);
});
