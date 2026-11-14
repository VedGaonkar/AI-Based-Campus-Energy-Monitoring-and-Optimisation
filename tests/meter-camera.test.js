import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import request from "supertest";
import { startDatabase } from "../scripts/database.mjs";
import { loadConfig } from "../backend/src/config.js";
import { createInstitutionApplication } from "../backend/src/workspaces/runtime.js";
import { parseMeterText, validateMeterCandidate } from "../backend/src/domain/meter-ocr.js";
import { createMeterCameraService, maintainMeterCameras } from "../backend/src/services/meter-camera.js";
import { recogniseMeter } from "../backend/src/adapters/meter-ocr.js";
let db, runtime, models, service, config, admin, foreign, viewer, camera, paired, first, hourCamera, hourFirst, hourTime, ocrReady;
const origin = "http://localhost:5000", password = randomBytes(24).toString("base64url"), key = randomInt(10000000, 100000000).toString();
const write = (member, path, body = {}, method = "post") => member.agent[method](`/api/v1${path}`).set("Origin", origin).set("X-CSRF-Token", member.csrf).send(body);
async function register(email, institutionName) {
  const agent = request.agent(runtime.app), csrf = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
  const response = await write({ agent, csrf }, "/auth/register", { name: institutionName, email, password, confirmPassword: password, institutionName, accountType: "administrator", adminKey: String(key), joinCode: `Meter-${email.replaceAll("@", "_").replaceAll(".", "_")}-2026` }); assert.equal(response.status, 201);
  return { agent, csrf: response.body.data.csrfToken, id: response.body.data.institution._id, user: response.body.data.user };
}
async function good(path, body, method = "post", member = admin) { const response = await write(member, path, body, method); assert.ok(response.status < 300, `${path}: ${response.status} ${JSON.stringify(response.body.error)}`); return response.body.data; }
function image(text, rotate = 0) {
  const script = "from PIL import Image,ImageDraw,ImageFont;import io,base64,sys,os;im=Image.new('RGB',(1000,260),'white');font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf' if os.path.isfile('C:/Windows/Fonts/arial.ttf') else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',105);ImageDraw.Draw(im).text((35,70),sys.argv[1],font=font,fill='black');im=im.rotate(int(sys.argv[2]),expand=True);out=io.BytesIO();im.save(out,format='PNG');print(base64.b64encode(out.getvalue()).decode())";
  return { mime: "image/png", image: execFileSync(config.ocrPython, ["-c", script, text, String(rotate)], { encoding: "utf8", windowsHide: true }).trim() };
}
const frame = (images, capturedAt = new Date(), extra = {}) => ({ captureId: randomUUID(), capturedAt: capturedAt.toISOString(), images, ...extra });
async function newCamera(meterId) { await good("/meters", { meterId, name: meterId, maxPowerKw: 100 }); return good("/meter-cameras", { meterId, name: `${meterId} display` }); }
const requireOcr = t => { if (!ocrReady) { t.skip("Optional real OCR unavailable: run npm run setup:ocr; this is not an OCR success"); return false; } return true; };
before(async () => {
  db = await startDatabase(); config = loadConfig({ NODE_ENV: "test", ADMIN_INVITE_KEY: String(key), MONGODB_URI: db.getUri("meter_camera_directory"), SESSION_SECRET: randomBytes(32).toString("hex"), SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"), FRONTEND_ORIGIN: origin, PUBLIC_APP_URL: origin });
  runtime = await createInstitutionApplication(config); admin = await register("meter-admin@camera.test", "Meter Institute"); foreign = await register("foreign@camera.test", "Foreign Meter Institute");
  models = (await runtime.directory.realm(admin.id)).models; service = createMeterCameraService(models, config);
  await good("/institutions/current/join-code", { joinCode: "Meter-Reader-Code-2026" }, "put");
  const agent = request.agent(runtime.app), csrf = (await agent.get("/api/v1/auth/csrf")).body.data.csrfToken;
  const joined = await write({ agent, csrf }, "/auth/register", { name: "Reader", email: "reader@camera.test", password, confirmPassword: password, accountType: "viewer", joinCode: "Meter-Reader-Code-2026" }); assert.equal(joined.status, 201); viewer = { agent, csrf: joined.body.data.csrfToken };
  camera = await newCamera("CAMERA-MAIN");
  try { ocrReady = (await recogniseMeter(config, { op: "health" })).available; } catch { ocrReady = false; }
});
after(async () => { await runtime?.close(); await db?.stop(); });

test("meter parsing requires the energy register, exact decimal interpretation and unambiguous numeric text", () => {
  const config = { unit: "kWh", registerLabel: "kWh", decimalMode: "dot", decimalPlaces: 2 };
  assert.equal(parseMeterText("12345.67 kWh", config).value, 12345.67);
  assert.equal(parseMeterText("12345,67 kWh", { ...config, decimalMode: "comma" }).value, 12345.67);
  assert.equal(parseMeterText("1234567 kWh", { ...config, decimalMode: "implied" }).value, 12345.67);
  assert.equal(parseMeterText("100000 Wh", { ...config, unit: "Wh", registerLabel: "Wh", decimalPlaces: 0 }).value, 100);
  for (const text of ["12.34 kW", "220 V", "123.45 kWh 230 V", "12.345,67 kWh", "O123.45 kWh", "12345 kWh"]) assert.ok(parseMeterText(text, config).reasons.length, text);
  assert.ok(parseMeterText("123.45 kWh", { ...config, registerLabel: "1.8.0" }).reasons.includes("REGISTER_NOT_IDENTIFIED"));
  assert.ok(validateMeterCandidate({ value: 1000, capturedAt: new Date(), receivedAt: new Date(), previous: { value: 100, capturedAt: new Date(Date.now() - 3600000) }, maxPowerKw: 10000 }).includes("POSSIBLE_DECIMAL_SHIFT"));
});

test("registration is admin/institution scoped, defaults hourly, rejects URL feeds and occupancy pairing", async () => {
  assert.equal(camera.intervalMinutes, 60); assert.equal(camera.purpose, "meter"); assert.equal(camera.autoAccept, false);
  assert.equal((await viewer.agent.get("/api/v1/meter-cameras")).status, 403);
  assert.equal((await write(foreign, `/meter-cameras/${camera._id}`, { intervalMinutes: 30 }, "patch")).status, 404);
  assert.equal((await write(admin, "/meter-cameras", { meterId: "CAMERA-MAIN", name: "URL", url: "https://camera.example/" })).status, 400);
  const issued = await good(`/meter-cameras/${camera._id}/pairing`);
  const phone = await request(runtime.app).post("/api/v1/meter-phone/pair").set("Origin", origin).send({ code: issued.code }); assert.equal(phone.status, 200, JSON.stringify(phone.body)); paired = phone.body.data;
  assert.equal((await request(runtime.app).post("/api/v1/meter-phone/pair").set("Origin", origin).send({ code: issued.code })).status, 401);
  assert.equal((await request(runtime.app).get("/api/v1/demo-phone/state").set("Authorization", `Bearer ${paired.token}`)).status, 401);
  assert.equal((await request(runtime.app).get("/api/v1/meter-phone/state").set("Authorization", `Bearer ${foreign.id}.${paired.token.split(".")[1]}`)).status, 401);
  const state = await request(runtime.app).get("/api/v1/meter-phone/state?active=1").set("Authorization", `Bearer ${paired.token}`); assert.equal(state.status, 200); assert.ok(state.body.data.request.id);
  assert.equal(await models.Observation.countDocuments(), 0);
});

test("real synthetic-image OCR stores immutable original evidence, review protects analytics, and duplicates are idempotent", async t => {
  if (!requireOcr(t)) return;
  const fixture = { mime: "image/png", image: readFileSync("fixtures/meter/synthetic-kwh.png").toString("base64") }, body = frame([fixture, fixture]);
  first = await good(`/meter-cameras/${camera._id}/test`, body);
  assert.equal(first.candidateKwh, 12345.67); assert.match(first.evidence.frames[0].text, /12345/); assert.equal(first.status, "needs_review"); assert.equal(first.validation.eligible, true);
  assert.equal(await models.MeterReading.countDocuments(), 0); assert.equal(await models.EnergyInterval.countDocuments(), 0); assert.equal(await models.Incident.countDocuments(), 0);
  const duplicate = await good(`/meter-cameras/${camera._id}/test`, body); assert.equal(duplicate._id, first._id); assert.equal(duplicate.duplicate, true);
  assert.equal((await foreign.agent.get(`/api/v1/meter-captures/${first._id}/images/0`)).status, 404); assert.equal((await viewer.agent.get(`/api/v1/meter-captures/${first._id}/images/0`)).status, 403);
  assert.equal((await admin.agent.get(`/api/v1/meter-captures/${first._id}/images/0`)).status, 200);
  await good(`/meter-captures/${first._id}/review`, { action: "accept", reason: "Checked synthetic display and cumulative unit" });
  assert.equal(await models.MeterReading.countDocuments({ validationState: "accepted" }), 1);
  await good(`/meter-cameras/${camera._id}`, { autoAccept: true }, "patch");
  const state = await request(runtime.app).get("/api/v1/meter-phone/state?active=1").set("Authorization", `Bearer ${paired.token}`);
  const nextImage = image("12345.68 kWh");
  const uploaded = await request(runtime.app).post("/api/v1/meter-phone/frames").set("Origin", origin).set("Authorization", `Bearer ${paired.token}`).send(frame([nextImage, nextImage], new Date(Date.now() + 60000), { jobId: state.body.data.request.id }));
  assert.equal(uploaded.status, 202); assert.equal(uploaded.body.data.status, "accepted", JSON.stringify(uploaded.body.data.validation)); assert.equal(uploaded.body.data.sourceType, "paired_meter_phone");
  await good(`/meter-cameras/${camera._id}`, { intervalMinutes: 60 }, "patch");
  assert.equal((await models.MeterCamera.findById(camera._id).lean()).autoAccept, false);
  assert.equal((await write(admin, `/meter-cameras/${camera._id}`, { autoAccept: true }, "patch")).status, 409);
});

test("real OCR respects configured orientation/ROI and refuses power-register or unreadable imagery", async t => {
  if (!requireOcr(t)) return;
  const rotated = image("12345.67 kWh", 90);
  const result = await recogniseMeter(config, { images: [rotated], configuration: { ...camera, orientation: 90 } });
  assert.equal(parseMeterText(result.frames[0].text, camera).value, 12345.67);
  const wrong = await good(`/meter-cameras/${camera._id}/test`, frame([image("12.34 kW")])); assert.ok(wrong.validation.reasons.includes("ENERGY_UNIT_NOT_IDENTIFIED")); assert.equal(wrong.status, "needs_review");
  const blank = await good(`/meter-cameras/${camera._id}/test`, frame([image("")])); assert.equal(blank.candidateKwh, null); assert.ok(blank.validation.reasons.includes("NO_NUMERIC_CANDIDATE"));
  assert.equal(await models.MeterReading.countDocuments(), 2);
});

test("accepted cumulative readings yield hourly kWh; OCR and CSV alternatives never double count", async t => {
  if (!requireOcr(t)) return;
  hourCamera = await newCamera("HOURLY"); hourTime = new Date(Date.now() - 7200000);
  await good("/meter-readings", { eventId: randomUUID(), meterId: "HOURLY", value: 100, capturedAt: hourTime.toISOString(), sourceType: "csv", dataMode: "simulated" });
  hourFirst = await good(`/meter-cameras/${hourCamera._id}/test`, frame([image("100.00 kWh")], hourTime));
  await good(`/meter-captures/${hourFirst._id}/review`, { action: "accept", reason: "Backfill timestamp and displayed counter verified" });
  assert.equal(await models.MeterReading.countDocuments({ meterId: "HOURLY" }), 1);
  const second = await good(`/meter-cameras/${hourCamera._id}/test`, frame([image("101.25 kWh")], new Date(+hourTime + 3600000)));
  await good(`/meter-captures/${second._id}/review`, { action: "accept", reason: "Reviewed one-hour synthetic cumulative capture" });
  let intervals = await models.EnergyInterval.find({ meterId: "HOURLY" }).lean(); assert.equal(intervals.length, 1); assert.equal(intervals[0].energyKwh, 1.25); assert.equal(intervals[0].averagePowerKw, 1.25);
  await good("/meter-readings", { eventId: randomUUID(), meterId: "HOURLY", kind: "interval", value: 1.25, intervalStart: hourTime.toISOString(), capturedAt: new Date(+hourTime + 3600000).toISOString(), sourceType: "csv", dataMode: "simulated" });
  intervals = await models.EnergyInterval.find({ meterId: "HOURLY" }).lean(); assert.equal(intervals.length, 1); assert.equal(intervals[0].energyKwh, 1.25);
});

test("non-monotonic/future/stale candidates require review; correction preserves OCR and records its author", async t => {
  if (!requireOcr(t)) return;
  const row = await good(`/meter-cameras/${hourCamera._id}/test`, frame([image("90.00 kWh")], new Date(+hourTime + 5400000)));
  assert.ok(row.validation.reasons.includes("NON_MONOTONIC")); assert.ok(row.validation.reasons.includes("STALE_CAPTURE"));
  const before = await models.MeterReading.countDocuments();
  assert.equal((await write(admin, `/meter-captures/${row._id}/review`, { action: "accept", reason: "Wrong counter must remain blocked" })).status, 409);
  // addReading retained a rejected candidate; it cannot enter intervals.
  assert.equal(await models.MeterReading.countDocuments({ meterId: "HOURLY", validationState: "accepted", value: 90 }), 0);
  const corrected = await good(`/meter-captures/${row._id}/review`, { action: "correct", value: 101.5, reason: "Visually checked original digits; OCR candidate wrong" });
  assert.equal(corrected.candidateKwh, 90); assert.equal(corrected.evidence.frames[0].text, row.evidence.frames[0].text); assert.equal(corrected.reviewedValue, 101.5); assert.equal(corrected.reviews.at(-1).actorId, admin.user._id);
  const future = await good(`/meter-cameras/${hourCamera._id}/test`, frame([image("102.00 kWh")], new Date(Date.now() + 3600000)));
  assert.ok(future.validation.reasons.includes("FUTURE_TIMESTAMP")); assert.equal((await write(admin, `/meter-captures/${future._id}/review`, { action: "accept", reason: "Future time cannot be accepted" })).status, 409);
});

test("camera loss/worker restart produces missed captures and no outage backlog or occupancy evidence", async () => {
  const loss = await newCamera("LOSS"), pairing = await good(`/meter-cameras/${loss._id}/pairing`);
  const phone = (await request(runtime.app).post("/api/v1/meter-phone/pair").set("Origin", origin).send({ code: pairing.code })).body.data;
  const state = await request(runtime.app).get("/api/v1/meter-phone/state?active=1").set("Authorization", `Bearer ${phone.token}`); assert.ok(state.body.data.request);
  await request(runtime.app).post("/api/v1/meter-phone/offline").set("Origin", origin).set("Authorization", `Bearer ${phone.token}`).send({});
  assert.equal((await service.list()).find(row => row._id === loss._id).health, "offline");
  await maintainMeterCameras(models, new Date(Date.now() + 10800000));
  assert.ok(await models.MeterCaptureJob.countDocuments({ cameraId: loss._id, status: "missed" })); assert.equal(await models.MeterCaptureJob.countDocuments({ cameraId: loss._id, status: "pending" }), 0);
  assert.equal(await models.Observation.countDocuments(), 0); assert.equal(await models.Command.countDocuments(), 0);
});

test("a missing hourly capture yields one gap aggregate, never invented hourly values", async t => {
  if (!requireOcr(t)) return;
  const gap = await newCamera("GAP");
  for (const [value, offset] of [[200, -14400000], [204, -3600000]]) {
    const row = await good(`/meter-cameras/${gap._id}/test`, frame([image(`${value.toFixed(2)} kWh`)], new Date(Date.now() + offset)));
    await good(`/meter-captures/${row._id}/review`, { action: "correct", value, reason: "Reviewed historical synthetic meter time and digits" });
  }
  const intervals = await models.EnergyInterval.find({ meterId: "GAP" }).lean(); assert.equal(intervals.length, 1); assert.equal(intervals[0].coverage, "gap_aggregate"); assert.equal(intervals[0].energyKwh, 4); assert.ok(Math.abs(intervals[0].durationHours - 3) < .001);
});

test("recorded replacement/reset isolates epochs and revokes the old camera instead of inventing cross-reset consumption", async t => {
  if (!requireOcr(t)) return;
  const effectiveAt = new Date(Date.now() - 900000).toISOString();
  const input = { meterId: "HOURLY", fromEpoch: "initial", newEpoch: "replacement-2", type: "replacement", effectiveAt, reason: "Documented physical meter replacement for synthetic test" };
  const transition = await good("/meter-epoch-transitions", input); assert.equal(transition.status, "completed");
  assert.equal((await models.MeterCamera.findById(hourCamera._id).lean()).enabled, false);
  assert.equal((await good("/meter-epoch-transitions", input))._id, transition._id);
  const next = await good("/meter-cameras", { meterId: "HOURLY", epoch: "replacement-2", name: "Replacement meter" });
  for (const [value, at] of [[5, Date.now() - 600000], [7, Date.now() - 1000]]) {
    const capture = await good(`/meter-cameras/${next._id}/test`, frame([image(`${value.toFixed(2)} kWh`)], new Date(at)));
    await good(`/meter-captures/${capture._id}/review`, { action: "correct", value, reason: "New meter baseline and counter independently checked against original pixels" });
  }
  const intervals = await models.EnergyInterval.find({ meterId: "HOURLY", epoch: "replacement-2" }).lean(); assert.equal(intervals.length, 1); assert.equal(intervals[0].energyKwh, 2);
  assert.equal((await write(admin, `/meter-cameras/${hourCamera._id}`, { enabled: true }, "patch")).status, 409);
  assert.equal((await write(admin, "/meter-epoch-transitions", { ...input, fromEpoch: "replacement-2", newEpoch: "roll-3", type: "rollover", effectiveAt: new Date().toISOString() })).status, 400);
});

test("image expiry does not erase OCR evidence, and unsupported image bytes cannot create a reading", async t => {
  if (!requireOcr(t)) return;
  await models.MeterImage.updateMany({ cameraId: camera._id }, { $set: { expiresAt: new Date(0) } }); await maintainMeterCameras(models);
  assert.equal((await admin.agent.get(`/api/v1/meter-captures/${first._id}/images/0`)).status, 404); assert.match((await models.MeterCapture.findById(first._id).lean()).evidence.frames[0].text, /12345/);
  const before = await models.MeterReading.countDocuments();
  for (let i = 0; i < 12; i++) await models.MeterImage.create({ cameraId: camera._id, captureId: randomUUID(), frames: [], expiresAt: new Date(Date.now() + 86400000) });
  const bad = await good(`/meter-cameras/${camera._id}/test`, frame([{ mime: "image/png", image: Buffer.from("not a supported image but long enough").toString("base64") }]));
  assert.equal(bad.status, "needs_review"); assert.ok(bad.validation.reasons.includes("INVALID_METER_IMAGE")); assert.equal(await models.MeterReading.countDocuments(), before);
  assert.equal(await models.MeterImage.countDocuments({ cameraId: camera._id }), 12);
});
