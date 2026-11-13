import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { randomBytes, createHmac } from "node:crypto";
import { startDatabase } from "../scripts/database.mjs";
import { connectDatabase } from "../backend/src/models/index.js";
import { loadConfig } from "../backend/src/config.js";
import { createApplication } from "../backend/src/app.js";
import { seed } from "../backend/src/seed.js";
import { tick } from "../backend/src/workers/tick.js";
import { createRoomMaster } from "../backend/src/adapters/room-master.js";
let db, connection, models, runtime, config, admin, csrf;
const password = randomBytes(18).toString("hex"),
  origin = "http://localhost:5000";
before(async () => {
  db = await startDatabase();
  ({ connection, models } = await connectDatabase(db.getUri("campus_test")));
  config = loadConfig({
    NODE_ENV: "test",
    MONGODB_URI: db.getUri("campus_test"),
    SESSION_SECRET: randomBytes(32).toString("hex"),
    SERVICE_INGEST_TOKEN: randomBytes(32).toString("hex"),
    DEMO_MODE: "true",
    DEMO_TIME_SCALE: "60",
    ALLOW_PHYSICAL_CONTROL: "false",
    PUBLIC_APP_URL: origin,
    ADMIN_INVITE_KEY: "12345678",
  });
  await seed(models, config, { password });
  runtime = createApplication({ config, connection, models });
  admin = request.agent(runtime.app);
  const token = await admin.get("/api/v1/auth/csrf");
  const result = await admin
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .set("X-CSRF-Token", token.body.data.csrfToken)
    .send({ email: "admin@campus.test", password, adminKey: config.adminInviteKey });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  csrf = result.body.data.csrfToken;
});
after(async () => {
  if (runtime) await runtime.close();
  if (connection) await connection.close();
  if (db) await db.stop();
});
const mutate = (path, body, method = "post", agent = admin, token = csrf) =>
  agent[method](path)
    .set("Origin", origin)
    .set("X-CSRF-Token", token)
    .send(body);
test("seed actually persists thirty-day synthetic history, intervals and anomalies", async () => {
  const readings = await models.MeterReading.countDocuments({
      dataMode: "simulated",
    }),
    intervals = await models.EnergyInterval.countDocuments({
      dataMode: "simulated",
    });
  assert.ok(readings >= 696, `Only ${readings} seed readings persisted`);
  assert.ok(intervals >= 696, `Only ${intervals} intervals persisted`);
  assert.ok(
    (await models.EnergyInterval.countDocuments({ anomalous: true })) > 0,
  );
  assert.equal(
    await models.MeterReading.countDocuments({ dataMode: "live" }),
    0,
  );
});
test("session login, scoped rooms and no password-hash leakage", async () => {
  const rooms = await admin.get("/api/v1/rooms");
  assert.equal(rooms.status, 200);
  assert.equal(rooms.body.data.length, 3);
  const me = await admin.get("/api/v1/auth/me");
  assert.equal(me.body.data.user.role, "admin");
  assert.ok(!JSON.stringify(me.body).includes("passwordHash"));
  assert.equal((await request(runtime.app).get("/api/v1/rooms")).status, 401);
});
test("CSRF/origin rejection, viewer mutation denial and room-scoped reads", async () => {
  assert.equal(
    (await admin.patch("/api/v1/settings").send({ tariff: 9 })).status,
    403,
  );
  assert.equal(
    (
      await admin
        .patch("/api/v1/settings")
        .set("Origin", "https://untrusted.test")
        .set("X-CSRF-Token", csrf)
        .send({ tariff: 9 })
    ).status,
    403,
  );
  const viewer = request.agent(runtime.app),
    t = await viewer.get("/api/v1/auth/csrf");
  const login = await viewer
    .post("/api/v1/auth/login")
    .set("Origin", origin)
    .set("X-CSRF-Token", t.body.data.csrfToken)
    .send({ email: "viewer@campus.test", password });
  assert.equal(login.status, 200);
  assert.equal(
    (
      await mutate(
        "/api/v1/rooms/room-r101/supply-commands",
        { requestId: "bad-viewer", action: "off", reason: "staff_override" },
        "post",
        viewer,
        login.body.data.csrfToken,
      )
    ).status,
    403,
  );
  await models.User.updateOne(
    { _id: "demo-viewer" },
    { $set: { permittedRoomIds: ["room-r102"] } },
  );
  assert.equal(
    (await viewer.get("/api/v1/rooms/room-r101/status")).status,
    403,
  );
});
test("CSV preview/commit is durable and repeat-safe; intervals are calculated from accepted data", async () => {
  const csv =
    "meterId,capturedAt,readingKwh,register,source\nMAIN-01,2026-10-01T10:00:00+05:30,1200,import_kwh,manual\nMAIN-01,2026-10-01T11:00:00+05:30,1206,import_kwh,manual";
  const preview = await mutate("/api/v1/imports/meter-readings", {
    csv,
    dataMode: "simulated",
  });
  assert.equal(preview.status, 201, JSON.stringify(preview.body));
  assert.equal(preview.body.data.errors.length, 0);
  const result = await mutate(
    `/api/v1/imports/${preview.body.data._id}/commit`,
    {},
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.data.imported, 2);
  const again = await mutate(
    `/api/v1/imports/${preview.body.data._id}/commit`,
    {},
  );
  assert.equal(again.body.data.duplicate, true);
  const interval = await models.EnergyInterval.findOne({
    startAt: new Date("2026-10-01T10:00:00+05:30"),
  }).lean();
  assert.equal(interval.energyKwh, 6);
  assert.equal(interval.averagePowerKw, 6);
  assert.equal(interval.dataMode, "simulated");
});
test("manual reading conflict, invalid CSV and OCR unavailable do not fabricate results", async () => {
  const result = await mutate("/api/v1/meter-readings", {
    eventId: "conflict",
    meterId: "MAIN-01",
    capturedAt: "2026-10-01T10:00:00+05:30",
    value: 999,
    dataMode: "simulated",
  });
  assert.equal(result.status, 409);
  const preview = await mutate("/api/v1/imports/timetable", {
    csv: "roomCode,startAt,endAt,title,status\nBAD,wrong,wrong,Class,confirmed",
    dataMode: "simulated",
  });
  assert.equal(preview.status, 201);
  assert.equal(preview.body.data.errors.length, 1);
  assert.equal(
    (await mutate(`/api/v1/imports/${preview.body.data._id}/commit`, {}))
      .status,
    400,
  );
  assert.equal((await mutate("/api/v1/meter-images", {})).status, 503);
});
test("audited manual review preserves provenance and reset configuration separates epochs", async () => {
  const settings = await models.Settings.findById("installation").lean();
  const configured = await mutate(
    "/api/v1/settings",
    {
      meters: [
        ...settings.meters,
        {
          meterId: "MAIN-01",
          epoch: "replacement",
          register: "import_kwh",
          maxPowerKw: 100,
        },
      ],
    },
    "patch",
  );
  assert.equal(configured.status, 200, JSON.stringify(configured.body));
  const entered = await mutate("/api/v1/meter-readings", {
    eventId: "review-ocr",
    meterId: "MAIN-01",
    epoch: "replacement",
    value: 12,
    capturedAt: "2026-10-01T10:00:00+05:30",
    sourceType: "camera_ocr",
    quality: {
      ocrConfidence: 0.2,
      registerMatched: true,
      burstAgreement: false,
    },
    dataMode: "simulated",
  });
  assert.equal(entered.status, 201, JSON.stringify(entered.body));
  assert.equal(entered.body.data.reading.validationState, "needs_review");
  const reviewed = await mutate(
    `/api/v1/meter-readings/${entered.body.data.reading._id}/review`,
    {
      value: 10,
      reason: "Staff visually confirmed the cumulative import register",
    },
    "patch",
  );
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  assert.equal(reviewed.body.data.validationState, "accepted");
  assert.equal(reviewed.body.data.corrections[0].oldValue, 12);
  assert.equal(reviewed.body.data.sourceType, "camera_ocr");
  assert.equal(reviewed.body.data.dataMode, "simulated");
  assert.equal(
    await models.EnergyInterval.countDocuments({ epoch: "replacement" }),
    0,
    "One reading cannot imply an interval or negative consumption across epochs",
  );
});
test("one room/master mapping and booking edits enforce contracts", async () => {
  assert.equal(
    (
      await mutate("/api/v1/rooms", {
        code: "R900",
        name: "Duplicate",
        roomBreakerId: "BRK-R101",
      })
    ).status,
    409,
  );
  const start = new Date(Date.now() + 3600000),
    end = new Date(Date.now() + 7200000);
  const booking = await mutate("/api/v1/schedules", {
    roomId: "room-r102",
    title: "Test class",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
  });
  assert.equal(booking.status, 201, JSON.stringify(booking.body));
  const cancelled = await mutate(
    `/api/v1/schedules/${booking.body.data._id}`,
    { status: "cancelled" },
    "patch",
  );
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.data.status, "cancelled");
  const renamed = await mutate(`/api/v1/schedules/${booking.body.data._id}`, { title: "Changed title only" }, "patch");
  assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
  assert.equal(renamed.body.data.status, "cancelled", "An omitted status must not resurrect a cancelled booking");
  const original = await models.Room.findById("room-r103").lean();
  const roomPatch = await mutate("/api/v1/rooms/room-r103", { name: "Renamed studio" }, "patch");
  assert.equal(roomPatch.status, 200, JSON.stringify(roomPatch.body));
  assert.deepEqual(roomPatch.body.data.requiredSourceIds, original.requiredSourceIds);
  assert.equal(roomPatch.body.data.independentInfrastructure, true);
  assert.equal(roomPatch.body.data.allowedStartHour, 0);
});
test("QR lookup has no control effect; lease extension invalidates old work and expiry stays unknown", async () => {
  const room = await models.Room.findById("room-r102").lean();
  const before = await models.Command.countDocuments();
  assert.equal(
    (await request(runtime.app).get(`/api/v1/access/${room.publicToken}`))
      .status,
    200,
  );
  assert.equal(await models.Command.countDocuments(), before);
  const lease = await mutate("/api/v1/rooms/room-r102/access-leases", {
    durationMinutes: 1,
    acceptedPolicy: true,
  });
  assert.equal(lease.status, 201, JSON.stringify(lease.body));
  const extended = await mutate(
    `/api/v1/access-leases/${lease.body.data._id}/extend`,
    { durationMinutes: 2, acceptedPolicy: true },
  );
  assert.equal(extended.status, 200);
  assert.equal(extended.body.data.revision, 2);
  const future = new Date(Date.now() + 5000);
  await tick(models, config, future, "worker-expiry");
  const status = await admin.get("/api/v1/rooms/room-r102/status");
  assert.equal(status.body.data.observed.state, "unknown");
  assert.equal(
    (await models.Breaker.findById("BRK-R102").lean()).reportedSupply,
    "on",
  );
});
test("persistent escalation recovers with a new worker and generates only simulated explicit commands", async () => {
  const base = new Date();
  await models.Room.updateOne(
    { _id: "room-r101" },
    { $set: { controlMode: "simulated" } },
  );
  await models.Integration.updateOne(
    { _id: "CAM-R101" },
    { $set: { health: "online", coverageValidated: true } },
  );
  for (const offset of [-20000, -10000, 0, 10000, 25000])
    await models.Observation.create({
      eventId: `timeline-${offset}`,
      sourceId: "CAM-R101",
      roomId: "room-r101",
      capturedAt: new Date(base.getTime() + offset),
      receivedAt: base,
      sourceType: "camera",
      occupancy: "vacant",
      confidence: 1,
      coverageValidated: true,
      quality: { usable: true },
      dataMode: "simulated",
      modelVersion: "test",
    });
  await tick(models, config, base, "worker-before-restart");
  const incident = await models.Incident.findOne({
    type: "vacancy",
    roomId: "room-r101",
    active: true,
  }).lean();
  assert.ok(incident);
  assert.equal(
    await models.Job.countDocuments({ incidentId: incident._id }),
    3,
  );
  // Reopen the actual Mongo connection to simulate process/session recovery, not just a browser countdown.
  const reconnected = await connectDatabase(db.getUri("campus_test"));
  try {
    await tick(
      reconnected.models,
      config,
      new Date(base.getTime() + 10000),
      "worker-after-restart",
    );
    await tick(
      reconnected.models,
      config,
      new Date(base.getTime() + 25000),
      "worker-after-restart",
    );
  } finally {
    await reconnected.connection.close();
  }
  const closed = await models.Incident.findById(incident._id).lean();
  assert.equal(closed.state, "resolved", JSON.stringify(closed));
  const command = await models.Command.findOne({
    incidentId: incident._id,
  }).lean();
  assert.equal(command.result.verification, "simulated");
  assert.equal(command.result.reportedOutput, "off");
  const adapter = createRoomMaster(models, config);
  const duplicate = await adapter.setSupply(
    "room-r101",
    {
      requestId: command.requestId,
      action: "off",
      reason: "vacancy_escalation",
    },
    "worker",
    new Date(base.getTime() + 26000),
  );
  assert.equal(duplicate._id, command._id);
  assert.equal(
    await models.Command.countDocuments({ requestId: command.requestId }),
    1,
  );
});
test("new occupancy cancels final work; faulted restoration remains blocked", async () => {
  const base = new Date(Date.now() + 40000);
  await models.Breaker.updateOne(
    { _id: "BRK-R101" },
    { $set: { reportedSupply: "on", automationDisabled: false } },
  );
  const incident = await models.Incident.create({
    issueKey: "vacancy:room-r101",
    roomId: "room-r101",
    type: "vacancy",
    active: true,
    state: "escalated",
    openedAt: new Date(base.getTime() - 24000),
    policyVersion: 1,
  });
  await models.Observation.create({
    eventId: "return",
    sourceId: "CAM-R101",
    roomId: "room-r101",
    capturedAt: base,
    receivedAt: base,
    occupancy: "occupied",
    confidence: 1,
    coverageValidated: true,
    quality: { usable: true },
    dataMode: "simulated",
    modelVersion: "test",
  });
  await tick(models, config, base, "worker-return");
  assert.equal(
    (await models.Incident.findById(incident._id).lean()).state,
    "cancelled",
  );
  assert.equal(
    (await models.Breaker.findById("BRK-R101").lean()).reportedSupply,
    "on",
  );
  await models.Breaker.updateOne(
    { _id: "BRK-R101" },
    {
      $set: {
        reportedSupply: "off",
        automationDisabled: true,
        faultTripped: true,
      },
    },
  );
  await tick(models, config, new Date(base.getTime() + 1000), "worker-fault");
  assert.equal(
    (await models.Breaker.findById("BRK-R101").lean()).reportedSupply,
    "off",
  );
});
test("service observations require a source-scoped credential", async () => {
  const body = {
    eventId: "service-spoof",
    sourceId: "CAM-R103",
    roomId: "room-r103",
    capturedAt: new Date().toISOString(),
    sourceType: "camera",
    occupancy: "occupied",
    confidence: 1,
    coverageValidated: true,
    quality: { usable: true },
    dataMode: "live",
    modelVersion: "test",
  };
  const token = createHmac("sha256", config.ingestToken)
    .update("CAM-R101")
    .digest("hex");
  assert.equal(
    (
      await request(runtime.app)
        .post("/api/v1/ingest/observations")
        .set("X-Source-Id", "CAM-R103")
        .set("Authorization", `Bearer ${token}`)
        .send(body)
    ).status,
    401,
  );
  const correct = createHmac("sha256", config.ingestToken)
    .update("CAM-R103")
    .digest("hex");
  const ingest = (payload) =>
    request(runtime.app)
      .post("/api/v1/ingest/observations")
      .set("X-Source-Id", "CAM-R103")
      .set("Authorization", `Bearer ${correct}`)
      .send(payload);
  assert.equal((await ingest(body)).status, 202);
  assert.equal((await ingest(body)).status, 202);
  assert.equal(
    await models.Observation.countDocuments({
      eventId: body.eventId,
      sourceId: body.sourceId,
    }),
    1,
  );
  assert.equal((await ingest({ ...body, occupancy: "vacant" })).status, 409);
});
test("staff normal-stop confirmation is audited and a supply restart invalidates it", async () => {
  const deviceId = "room-r103-ac";
  assert.equal(
    (
      await mutate(
        `/api/v1/devices/${deviceId}`,
        { requiresNormalStopBeforeCutoff: true },
        "patch",
      )
    ).status,
    200,
  );
  const supply = (action) =>
    mutate("/api/v1/rooms/room-r103/supply-commands", {
      requestId: `normal-stop-${action}-${Date.now()}`,
      action,
      reason: "staff_override",
    });
  assert.equal((await supply("off")).status, 409);
  const confirmed = await mutate(`/api/v1/devices/${deviceId}/confirm-stop`, {
    reason: "Approved normal stop completed using existing controls",
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.data.stopProcedureEvidence.actorId, "demo-admin");
  assert.equal((await supply("off")).status, 202);
  assert.equal((await supply("on")).status, 202);
  const device = await models.Device.findById(deviceId).lean();
  assert.equal(device.stopProcedureConfirmedAt, null);
  assert.ok(device.lastRestartAt);
});
test("interval and timetable CSV commit use their documented formats", async () => {
  const meter = await mutate("/api/v1/imports/meter-readings", {
    csv: "meterId,intervalStart,intervalEnd,energyKwh\nMAIN-01,2026-01-01T10:00:00+05:30,2026-01-01T11:00:00+05:30,4",
    dataMode: "simulated",
  });
  assert.equal(meter.status, 201);
  assert.equal(meter.body.data.errors.length, 0);
  assert.equal(
    (await mutate(`/api/v1/imports/${meter.body.data._id}/commit`, {})).status,
    200,
  );
  const schedule = await mutate("/api/v1/imports/timetable", {
    csv: "roomCode,startAt,endAt,title,status\nR103,2026-01-01T10:00:00+05:30,2026-01-01T11:00:00+05:30,Imported class,confirmed",
    dataMode: "simulated",
  });
  assert.equal(schedule.status, 201);
  assert.equal(schedule.body.data.errors.length, 0);
  assert.equal(
    (await mutate(`/api/v1/imports/${schedule.body.data._id}/commit`, {}))
      .status,
    200,
  );
  assert.ok(
    await models.Schedule.exists({
      title: "Imported class",
      roomId: "room-r103",
    }),
  );
});
test("acknowledgement stays unresolved and recommendation outcome review retains uncertainty", async () => {
  const incident = await models.Incident.findOne({
    type: "energy",
    active: true,
  }).lean();
  assert.ok(incident);
  const acknowledged = await mutate(
    `/api/v1/incidents/${incident._id}/acknowledge`,
    {},
  );
  assert.equal(acknowledged.status, 200);
  assert.equal(acknowledged.body.data.active, true);
  assert.equal(acknowledged.body.data.state, "inspecting");
  const r = await models.Recommendation.findOne({ status: "proposed" }).lean();
  assert.ok(r);
  assert.equal(
    (await mutate(`/api/v1/recommendations/${r._id}/complete`, {})).status,
    409,
  );
  assert.equal(
    (await mutate(`/api/v1/recommendations/${r._id}/accept`, {})).status,
    200,
  );
  assert.equal(
    (await mutate(`/api/v1/recommendations/${r._id}/complete`, {})).status,
    200,
  );
  assert.equal(
    (await mutate(`/api/v1/recommendations/${r._id}/verify`, {})).status,
    400,
  );
  const reviewed = await mutate(`/api/v1/recommendations/${r._id}/verify`, {
    reason:
      "Staff reviewed comparable use; weather and timetable effects remain uncertain",
    observedReductionKwh: 2,
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.data.status, "reviewed");
  assert.match(
    reviewed.body.data.outcome.label,
    /not independently verified savings/,
  );
});
