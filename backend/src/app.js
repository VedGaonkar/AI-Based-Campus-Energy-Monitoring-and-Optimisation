import express from "express";
import session from "express-session";
import MongoStore from "connect-mongo";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcrypt";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { Server } from "socket.io";
import { z } from "zod";
import QRCode from "qrcode";
import {
  loginInput,
  roomInput,
  deviceInput,
  scheduleInput,
  readingInput,
  observationInput,
  leaseInput,
  commandInput,
  settingsInput,
  parsePatch,
  id,
} from "../../shared/contracts.js";
import {
  fail,
  errorHandler,
  equalSecret,
  requireRole,
  requireRoom,
  scope,
  withRoomLock,
} from "./security/access.js";
import {
  roomContext,
  audit,
  getSettings,
  cancelRoomWork,
} from "./services/context.js";
import {
  addReading,
  previewImport,
  commitImport,
  refreshAnalytics,
  analyticsSummary,
  reviewReading,
} from "./services/energy.js";
import { accessAllowed } from "./domain/policies.js";
import { createRoomMaster } from "./adapters/room-master.js";

const admin = (user) => requireRole(user, ["admin"]);
const staff = (user) =>
  requireRole(user, ["admin", "hod", "technician", "teacher"]);
const responder = (user) => requireRole(user, ["admin", "hod", "technician"]);
const found = (value) => {
  if (!value) fail(404, "NOT_FOUND", "Record not found");
  return value;
};
const limit = (req) =>
  Math.min(200, Math.max(1, Number(req.query.limit) || 100));
const cleanRoom = ({ commandLockOwner, commandLockUntil, ...room }) => room;

export function createApplication({ config, connection, models }) {
  const app = express(),
    server = createServer(app),
    adapter = createRoomMaster(models, config);
  app.disable("x-powered-by");
  if (config.env === "production") app.set("trust proxy", 1);
  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader("X-Request-Id", req.requestId);
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: config.env === "production" ? undefined : false,
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  const store = MongoStore.create({
    client: connection.getClient(),
    dbName: connection.name,
    collectionName: "sessions",
    autoRemove: "native",
  });
  const sessions = session({
    name: "campus.sid",
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store,
    cookie: {
      httpOnly: true,
      secure: config.env === "production",
      sameSite: "strict",
      maxAge: 8 * 3600000,
    },
  });
  app.use(sessions);
  const origins = new Set([
    config.frontendOrigin,
    new URL(config.publicAppUrl).origin,
  ]);
  const api = express.Router();
  api.get("/health", (req, res) =>
    res.json({
      data: {
        status: "ok",
        demoMode: config.demoMode,
        physicalControl: false,
        timeScale: config.timeScale,
        serverTime: new Date().toISOString(),
      },
    }),
  );
  api.get("/ready", (req, res) =>
    res
      .status(connection.readyState === 1 ? 200 : 503)
      .json({
        data: {
          database: connection.readyState === 1 ? "ready" : "unavailable",
        },
      }),
  );
  api.get("/auth/csrf", (req, res) => {
    req.session.csrf ??= randomBytes(32).toString("hex");
    res.json({ data: { csrfToken: req.session.csrf } });
  });
  api.use(async (req, res, next) => {
    if (req.path.startsWith("/ingest/")) return next();
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (!origins.has(req.get("Origin")))
        fail(403, "ORIGIN_REJECTED", "Request origin is not allowed");
      if (
        !equalSecret(req.get("X-CSRF-Token"), req.session.csrf) ||
        !req.session.csrf
      )
        fail(403, "CSRF_REJECTED", "Refresh the session and retry");
    }
    if (req.session.userId)
      req.user = await models.User.findOne({
        _id: req.session.userId,
        active: true,
      }).lean();
    next();
  });
  api.post(
    "/auth/login",
    rateLimit({
      windowMs: 900000,
      limit: 20,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    async (req, res) => {
      const input = loginInput.parse(req.body),
        user = await models.User.findOne({
          email: input.email.toLowerCase(),
          active: true,
        })
          .select("+passwordHash")
          .lean();
      if (!user || !(await bcrypt.compare(input.password, user.passwordHash)))
        fail(401, "INVALID_LOGIN", "Email or password is incorrect");
      await new Promise((resolve, reject) =>
        req.session.regenerate((err) => (err ? reject(err) : resolve())),
      );
      req.session.userId = user._id;
      req.session.csrf = randomBytes(32).toString("hex");
      await new Promise((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve())),
      );
      const { passwordHash, ...publicUser } = user;
      await audit(models, user._id, "auth.login", user._id);
      res.json({ data: { user: publicUser, csrfToken: req.session.csrf } });
    },
  );
  api.post(
    "/auth/register",
    rateLimit({
      windowMs: 900000,
      limit: 10,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
    async (req, res) => {
      const input = z
        .object({
          name: z.string().min(1).max(200),
          email: z.email().max(200),
          password: z.string().min(8).max(200),
        })
        .strict()
        .parse(req.body);
      const existing = await models.User.findOne({
        email: input.email.toLowerCase(),
      }).lean();
      if (existing) fail(409, "EMAIL_TAKEN", "An account with that email already exists");
      const user = await models.User.create({
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash: await bcrypt.hash(input.password, 12),
        role: "viewer",
        permittedRoomIds: [],
      });
      await new Promise((resolve, reject) =>
        req.session.regenerate((err) => (err ? reject(err) : resolve())),
      );
      req.session.userId = user._id;
      req.session.csrf = randomBytes(32).toString("hex");
      await new Promise((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve())),
      );
      const { passwordHash, ...publicUser } = user.toObject();
      await audit(models, user._id, "auth.register", user._id);
      res.status(201).json({ data: { user: publicUser, csrfToken: req.session.csrf } });
    },
  );
  api.get("/access/:publicToken", async (req, res) => {
    const room = found(
      await models.Room.findOne({ publicToken: req.params.publicToken }).lean(),
    );
    res.json({
      data: {
        id: room._id,
        code: room.code,
        name: room.name,
        maximumDurationMinutes: config.qrMaxMinutes,
        requiresLogin: true,
        simulated: true,
        policy:
          "Authorised temporary supply; expiry does not establish vacancy.",
      },
    });
  });
  api.use("/ingest", async (req, res, next) => {
    const sourceId = id.parse(req.get("X-Source-Id"));
    const source = await models.Integration.findById(sourceId).lean();
    const expected = createHmac("sha256", config.ingestToken)
      .update(sourceId)
      .digest("hex");
    if (!source || !equalSecret(req.get("Authorization"), `Bearer ${expected}`))
      fail(401, "SERVICE_AUTH_REQUIRED", "Invalid scoped service credential");
    req.integration = source;
    next();
  });
  api.post("/ingest/observations", async (req, res) => {
    const row = observationInput.parse(req.body),
      source = req.integration;
    if (
      row.sourceId !== source._id ||
      row.roomId !== source.roomId ||
      row.sourceType !== source.type
    )
      fail(
        403,
        "SOURCE_SCOPE",
        "Observation does not match the integration mapping",
      );
    if (Math.abs(Date.now() - Date.parse(row.capturedAt)) > 300000)
      fail(
        400,
        "STALE_EVENT",
        "Capture must be within five minutes; original capture time must be preserved",
      );
    if (row.dataMode !== "live" && !config.demoMode)
      fail(
        400,
        "REPLAY_ISOLATED",
        "Replay evidence is restricted to demo mode",
      );
    const result = await withRoomLock(models, row.roomId, async () => {
      const duplicate = await models.Observation.findOne({
        sourceId: row.sourceId,
        eventId: row.eventId,
      }).lean();
      if (duplicate) {
        if (
          duplicate.occupancy !== row.occupancy ||
          duplicate.dataMode !== row.dataMode ||
          duplicate.capturedAt.getTime() !== Date.parse(row.capturedAt)
        )
          fail(409, "EVENT_CONFLICT", "Event ID belongs to different evidence");
        return duplicate;
      }
      const saved = await models.Observation.findOneAndUpdate(
        { sourceId: row.sourceId, eventId: row.eventId },
        { $setOnInsert: { ...row, receivedAt: new Date() } },
        { upsert: true, returnDocument: "after" },
      ).lean();
      await models.Integration.updateOne(
        { _id: source._id },
        { $set: { health: "online", lastSeenAt: new Date() } },
      );
      if (row.occupancy !== "vacant" || !row.quality.usable)
        await cancelRoomWork(
          models,
          row.roomId,
          "Occupancy observation invalidated vacancy work",
        );
      if (row.occupancy === "occupied" || row.occupancy === "unknown")
        await models.Device.updateMany(
          { roomId: row.roomId, requiresNormalStopBeforeCutoff: true },
          { $set: { stopProcedureConfirmedAt: null } },
        );
      return saved;
    });
    res.status(202).json({ data: result });
  });
  api.post("/ingest/meter-readings", async (req, res) => {
    if (
      req.integration.type !== "meter" ||
      req.integration.capabilities?.meterId !== req.body.meterId
    )
      fail(403, "SOURCE_SCOPE", "Meter is outside the integration scope");
    res
      .status(202)
      .json({
        data: await addReading(
          models,
          req.body,
          `service:${req.integration._id}`,
          config,
        ),
      });
  });
  api.post("/ingest/device-events", () =>
    fail(
      503,
      "ADAPTER_UNAVAILABLE",
      "Physical device telemetry adapter is not commissioned",
    ),
  );
  api.use((req, res, next) => {
    if (!req.user) fail(401, "AUTH_REQUIRED", "Sign in to continue");
    next();
  });
  api.get("/auth/me", (req, res) =>
    res.json({ data: { user: req.user, csrfToken: req.session.csrf } }),
  );
  api.post("/auth/logout", async (req, res) => {
    await new Promise((resolve, reject) =>
      req.session.destroy((err) => (err ? reject(err) : resolve())),
    );
    res.clearCookie("campus.sid");
    res.json({ data: { loggedOut: true } });
  });
  api.get("/settings", async (req, res) =>
    res.json({ data: await getSettings(models) }),
  );
  api.patch("/settings", async (req, res) => {
    admin(req.user);
    const patch = settingsInput.parse(req.body);
    await models.Settings.updateOne({ _id: "installation" }, { $set: patch });
    await refreshAnalytics(models, config);
    await audit(models, req.user._id, "settings.update", "installation");
    res.json({ data: await getSettings(models) });
  });
  api.get("/users", async (req, res) => {
    responder(req.user);
    res.json({
      data: await models.User.find(
        req.user.role === "admin" ? {} : { _id: { $in: [req.user._id] } },
      )
        .limit(200)
        .lean(),
    });
  });
  api.post("/users", async (req, res) => {
    admin(req.user);
    const input = z
      .object({
        name: z.string().min(1).max(200),
        email: z.email(),
        password: z.string().min(12).max(100),
        role: z.enum(["admin", "hod", "technician", "teacher", "viewer"]),
        permittedRoomIds: z.array(id).max(100),
      })
      .strict()
      .parse(req.body);
    const { password, ...fields } = input;
    for (const roomId of fields.permittedRoomIds)
      found(await models.Room.findById(roomId).lean());
    const user = await models.User.create({
      ...fields,
      passwordHash: await bcrypt.hash(password, 12),
    });
    await audit(models, req.user._id, "user.create", user._id);
    const { passwordHash, ...safe } = user.toObject();
    res.status(201).json({ data: safe });
  });
  api.get("/rooms", async (req, res) =>
    res.json({
      data: (
        await models.Room.find(
          req.user.role === "admin"
            ? {}
            : { _id: { $in: req.user.permittedRoomIds } },
        )
          .sort({ code: 1 })
          .lean()
      ).map(cleanRoom),
    }),
  );
  api.post("/rooms", async (req, res) => {
    admin(req.user);
    const input = roomInput.parse(req.body);
    if (
      (await models.Breaker.exists({ _id: input.roomBreakerId })) ||
      (await models.Room.exists({ roomBreakerId: input.roomBreakerId }))
    )
      fail(409, "DUPLICATE_MASTER", "Master is already mapped");
    const room = await models.Room.create(input);
    try {
      await models.Breaker.create({
        _id: room.roomBreakerId,
        roomId: room._id,
        adapter: "simulator",
        nativeDeviceId: room.roomBreakerId,
      });
    } catch (err) {
      await models.Room.deleteOne({ _id: room._id });
      throw err;
    }
    await audit(models, req.user._id, "room.create", room._id);
    res.status(201).json({ data: cleanRoom(room.toObject()) });
  });
  api.get("/rooms/:id", async (req, res) => {
    requireRoom(req.user, req.params.id);
    res.json({
      data: cleanRoom(found(await models.Room.findById(req.params.id).lean())),
    });
  });
  api.patch("/rooms/:id", async (req, res) => {
    admin(req.user);
    const patch = parsePatch(roomInput, req.body);
    const room = await withRoomLock(models, req.params.id, async (room) => {
      if (patch.roomBreakerId && patch.roomBreakerId !== room.roomBreakerId)
        fail(
          409,
          "MASTER_REMAP_REQUIRES_REVIEW",
          "Create a new reviewed mapping; existing masters cannot be silently replaced",
        );
      if (
        (patch.allowedStartHour ?? room.allowedStartHour) >=
        (patch.allowedEndHour ?? room.allowedEndHour)
      )
        fail(400, "INVALID_HOURS", "End hour must follow start");
      for (const sourceId of patch.requiredSourceIds ?? [])
        if (
          !(await models.Integration.exists({
            _id: sourceId,
            roomId: room._id,
          }))
        )
          fail(
            400,
            "SOURCE_SCOPE",
            "Required source is not mapped to this room",
          );
      for (const field of [
        "firstResponderId",
        "secondResponderId",
        "backupResponderId",
      ])
        if (
          patch[field] &&
          !(await models.User.exists({
            _id: patch[field],
            active: true,
            role: { $in: ["admin", "hod", "technician"] },
          }))
        )
          fail(
            400,
            "INVALID_ASSIGNMENT",
            "Responder must be an active staff account",
          );
      await models.Room.updateOne(
        { _id: room._id },
        { $set: patch, $inc: { policyVersion: 1 } },
      );
      await cancelRoomWork(models, room._id, "Room policy changed");
      return models.Room.findById(room._id).lean();
    });
    await audit(models, req.user._id, "room.update", room._id);
    res.json({ data: cleanRoom(room) });
  });
  api.get("/rooms/:id/status", async (req, res) => {
    requireRoom(req.user, req.params.id);
    const room = found(await models.Room.findById(req.params.id).lean());
    const context = await roomContext(models, room, config);
    context.room = cleanRoom(room);
    res.json({ data: context });
  });
  api.get("/rooms/:id/assignments", async (req, res) => {
    requireRoom(req.user, req.params.id);
    const r = found(await models.Room.findById(req.params.id).lean());
    res.json({
      data: {
        firstResponderId: r.firstResponderId,
        secondResponderId: r.secondResponderId,
        backupResponderId: r.backupResponderId,
      },
    });
  });
  api.patch("/rooms/:id/assignments", async (req, res) => {
    admin(req.user);
    const patch = z
      .object({
        firstResponderId: id.nullable(),
        secondResponderId: id.nullable(),
        backupResponderId: id.nullable(),
      })
      .partial()
      .strict()
      .parse(req.body);
    for (const value of Object.values(patch))
      if (
        value &&
        !(await models.User.exists({
          _id: value,
          active: true,
          role: { $in: ["admin", "hod", "technician"] },
        }))
      )
        fail(400, "INVALID_ASSIGNMENT", "Responder must be active staff");
    await withRoomLock(models, req.params.id, async (room) => {
      await models.Room.updateOne(
        { _id: room._id },
        { $set: patch, $inc: { policyVersion: 1 } },
      );
      await cancelRoomWork(models, room._id, "Assignments changed");
    });
    res.json({ data: patch });
  });
  api.get("/devices", async (req, res) =>
    res.json({
      data: await models.Device.find(scope(req.user)).limit(200).lean(),
    }),
  );
  api.post("/devices/:id/confirm-stop", async (req, res) => {
    responder(req.user);
    const input = z
      .object({ reason: z.string().min(5).max(500) })
      .strict()
      .parse(req.body);
    const device = found(await models.Device.findById(req.params.id).lean());
    requireRoom(req.user, device.roomId);
    if (!device.requiresNormalStopBeforeCutoff)
      fail(
        400,
        "STOP_NOT_REQUIRED",
        "This inventory item has no normal-stop procedure",
      );
    await withRoomLock(models, device.roomId, async () => {
      await models.Device.updateOne(
        { _id: device._id },
        {
          $set: {
            stopProcedureConfirmedAt: new Date(),
            stopProcedureEvidence: {
              actorId: req.user._id,
              reason: input.reason,
              at: new Date(),
            },
          },
        },
      );
    });
    await audit(
      models,
      req.user._id,
      "device.stop_confirmed",
      device._id,
      "Staff confirmation recorded; this does not operate an individual appliance",
    );
    res.json({ data: await models.Device.findById(device._id).lean() });
  });
  api.post("/devices", async (req, res) => {
    admin(req.user);
    const input = deviceInput.parse(req.body);
    const room = found(await models.Room.findById(input.roomId).lean());
    const result = await withRoomLock(models, room._id, async () => {
      const saved = await models.Device.create({
        ...input,
        controlledByRoomBreakerId: room.roomBreakerId,
      });
      await models.Room.updateOne(
        { _id: room._id },
        { $inc: { policyVersion: 1 } },
      );
      await cancelRoomWork(models, room._id, "Inventory changed");
      return saved;
    });
    await audit(models, req.user._id, "device.create", result._id);
    res.status(201).json({ data: result });
  });
  api.patch("/devices/:id", async (req, res) => {
    admin(req.user);
    const device = found(await models.Device.findById(req.params.id).lean()),
      input = parsePatch(deviceInput, req.body);
    if (input.roomId && input.roomId !== device.roomId)
      fail(
        400,
        "ROOM_IMMUTABLE",
        "Moving a load requires a reviewed physical mapping",
      );
    await withRoomLock(models, device.roomId, async () => {
      await models.Device.updateOne({ _id: device._id }, { $set: input });
      await models.Room.updateOne(
        { _id: device.roomId },
        { $inc: { policyVersion: 1 } },
      );
      await cancelRoomWork(models, device.roomId, "Load approval changed");
    });
    await audit(models, req.user._id, "device.update", device._id);
    res.json({ data: await models.Device.findById(device._id).lean() });
  });
  api.get("/schedules", async (req, res) =>
    res.json({
      data: await models.Schedule.find(scope(req.user))
        .sort({ startAt: -1 })
        .limit(limit(req))
        .lean(),
    }),
  );
  api.post("/schedules", async (req, res) => {
    staff(req.user);
    const input = scheduleInput.parse(req.body);
    requireRoom(req.user, input.roomId);
    const row = await withRoomLock(models, input.roomId, async () => {
      const saved = await models.Schedule.create({
        ...input,
        timezone: "Asia/Kolkata",
      });
      await cancelRoomWork(models, input.roomId, "New booking");
      return saved;
    });
    await audit(models, req.user._id, "schedule.create", row._id);
    res.status(201).json({ data: row });
  });
  api.patch("/schedules/:id", async (req, res) => {
    staff(req.user);
    const old = found(await models.Schedule.findById(req.params.id).lean());
    requireRoom(req.user, old.roomId);
    const patch = parsePatch(scheduleInput, req.body);
    if (patch.roomId && patch.roomId !== old.roomId)
      fail(400, "ROOM_IMMUTABLE", "Create a separate booking to change rooms");
    const input = scheduleInput.parse({
      roomId: old.roomId,
      title: old.title,
      status: old.status,
      startAt: old.startAt.toISOString(),
      endAt: old.endAt.toISOString(),
      ...patch,
    });
    await withRoomLock(models, old.roomId, async () => {
      await models.Schedule.updateOne({ _id: old._id }, { $set: input });
      await cancelRoomWork(models, old.roomId, "Booking changed");
    });
    await audit(models, req.user._id, "schedule.update", old._id);
    res.json({ data: await models.Schedule.findById(old._id).lean() });
  });
  for (const [path, type] of [
    ["/imports/meter-readings", "meter"],
    ["/imports/timetable", "timetable"],
  ])
    api.post(path, async (req, res) => {
      admin(req.user);
      const input = z
        .object({
          csv: z.string().max(1048576),
          dataMode: z.enum(["live", "simulated"]).default("simulated"),
        })
        .strict()
        .parse(req.body);
      res
        .status(201)
        .json({
          data: await previewImport(
            models,
            { ...input, type },
            req.user._id,
            config,
          ),
        });
    });
  api.post("/imports/:id/commit", async (req, res) => {
    admin(req.user);
    res.json({
      data: await commitImport(models, req.params.id, req.user._id, config),
    });
  });
  api.post("/meter-readings", async (req, res) => {
    responder(req.user);
    res
      .status(201)
      .json({ data: await addReading(models, req.body, req.user._id, config) });
  });
  api.get("/meter-readings", async (req, res) =>
    res.json({
      data: await models.MeterReading.find()
        .sort({ capturedAt: -1 })
        .limit(limit(req))
        .lean(),
    }),
  );
  api.patch("/meter-readings/:id/review", async (req, res) => {
    responder(req.user);
    const input = z
      .object({
        value: z.number().nonnegative(),
        reason: z.string().min(5).max(1000),
      })
      .strict()
      .parse(req.body);
    res.json({
      data: await reviewReading(
        models,
        req.params.id,
        input,
        req.user._id,
        config,
      ),
    });
  });
  api.post("/meter-images", () =>
    fail(
      503,
      "OCR_UNAVAILABLE",
      "OCR adapter is not configured; use reviewed manual readings or CSV",
    ),
  );
  api.get("/analytics/summary", async (req, res) =>
    res.json({ data: await analyticsSummary(models) }),
  );
  api.get("/analytics/intervals", async (req, res) => {
    const intervals = await models.EnergyInterval.find()
      .sort({ startAt: -1 })
      .limit(1500)
      .lean();
    res.json({ data: intervals.reverse() });
  });
  api.get("/analytics/anomalies", async (req, res) =>
    res.json({
      data: await models.EnergyInterval.find({ anomalous: true })
        .sort({ startAt: -1 })
        .limit(100)
        .lean(),
    }),
  );
  const visibleIncidents = (user) =>
    user.role === "admin"
      ? {}
      : {
          $or: [
            { roomId: { $in: user.permittedRoomIds } },
            { roomId: { $exists: false } },
          ],
        };
  api.get("/incidents", async (req, res) =>
    res.json({
      data: await models.Incident.find(visibleIncidents(req.user))
        .sort({ openedAt: -1 })
        .limit(limit(req))
        .lean(),
    }),
  );
  const incidentFor = async (req) => {
    const record = found(await models.Incident.findById(req.params.id).lean());
    if (record.roomId) requireRoom(req.user, record.roomId);
    return record;
  };
  api.get("/incidents/:id", async (req, res) => {
    const incident = await incidentFor(req);
    res.json({
      data: {
        ...incident,
        jobs: await models.Job.find({ incidentId: incident._id })
          .sort({ dueAt: 1 })
          .lean(),
        commands: await models.Command.find({
          incidentId: incident._id,
        }).lean(),
      },
    });
  });
  for (const action of [
    "acknowledge",
    "inspect",
    "snooze",
    "resolve",
    "reassign",
  ])
    api.post(`/incidents/:id/${action}`, async (req, res) => {
      responder(req.user);
      const incident = await incidentFor(req);
      if (!incident.active)
        fail(409, "INCIDENT_CLOSED", "Incident is no longer active");
      const input = z
        .object({
          reason: z.string().max(1000).optional(),
          durationMinutes: z.number().int().min(1).max(30).optional(),
          firstResponderId: id.optional(),
          secondResponderId: id.optional(),
        })
        .strict()
        .parse(req.body ?? {});
      const patch = {};
      if (action === "acknowledge" || action === "inspect") {
        patch.state = "inspecting";
        patch.acknowledgedBy = req.user._id;
      }
      if (action === "snooze") {
        patch.state = "snoozed";
        patch.snoozedUntil = new Date(
          Date.now() +
            ((input.durationMinutes ?? 5) * 60000) / config.timeScale,
        );
      }
      if (action === "resolve") {
        if (!input.reason)
          fail(
            400,
            "EVIDENCE_REQUIRED",
            "Record resolution evidence or a manual confirmation",
          );
        patch.active = false;
        patch.state = "resolved";
        patch.resolution = {
          method: "manually_confirmed",
          actorId: req.user._id,
          reason: input.reason,
          at: new Date(),
        };
      }
      if (action === "reassign") {
        admin(req.user);
        for (const key of ["firstResponderId", "secondResponderId"])
          if (input[key]) {
            if (
              !(await models.User.exists({
                _id: input[key],
                active: true,
                role: { $in: ["admin", "hod", "technician"] },
              }))
            )
              fail(400, "INVALID_ASSIGNMENT", "Choose an active responder");
            patch[key] = input[key];
          }
      }
      const operation = async () => {
        await models.Incident.updateOne(
          { _id: incident._id, active: true },
          {
            $set: patch,
            $push: {
              timeline: {
                at: new Date(),
                event: action,
                actorId: req.user._id,
                reason: input.reason,
              },
            },
          },
        );
        if (action === "resolve")
          await models.Job.updateMany(
            {
              incidentId: incident._id,
              status: { $in: ["pending", "leased"] },
            },
            { $set: { status: "cancelled" } },
          );
      };
      if (incident.roomId)
        await withRoomLock(models, incident.roomId, operation);
      else await operation();
      await audit(models, req.user._id, `incident.${action}`, incident._id);
      res.json({ data: await models.Incident.findById(incident._id).lean() });
    });
  api.get("/recommendations", async (req, res) =>
    res.json({
      data: await models.Recommendation.find(
        req.user.role === "admin"
          ? {}
          : {
              $or: [
                { roomId: { $in: req.user.permittedRoomIds } },
                { roomId: { $exists: false } },
                { roomId: null },
              ],
            },
      )
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    }),
  );
  for (const action of ["accept", "reject", "schedule", "complete", "verify"])
    api.post(`/recommendations/:id/${action}`, async (req, res) => {
      responder(req.user);
      const r = found(
        await models.Recommendation.findById(req.params.id).lean(),
      );
      if (r.roomId) requireRoom(req.user, r.roomId);
      const input = z
        .object({
          reason: z.string().max(1000).optional(),
          dueAt: z.iso.datetime({ offset: true }).optional(),
          observedReductionKwh: z.number().optional(),
        })
        .strict()
        .parse(req.body ?? {});
      const allowed = {
        accept: ["proposed"],
        reject: ["proposed", "accepted", "scheduled"],
        schedule: ["accepted", "scheduled"],
        complete: ["accepted", "scheduled"],
        verify: ["completed"],
      };
      if (!allowed[action].includes(r.status))
        fail(
          409,
          "INVALID_TRANSITION",
          "Action is not valid for the current recommendation status",
        );
      if (["reject", "verify"].includes(action) && !input.reason)
        fail(
          400,
          "REASON_REQUIRED",
          "Record a reason and the evidence limitations",
        );
      if (action === "schedule" && !input.dueAt)
        fail(400, "DUE_DATE_REQUIRED", "Choose a follow-up date");
      const states = {
        accept: "accepted",
        reject: "rejected",
        schedule: "scheduled",
        complete: "completed",
        verify: "reviewed",
      };
      const patch = {
        status: states[action],
        ...(input.dueAt ? { dueAt: new Date(input.dueAt) } : {}),
      };
      if (action === "verify")
        patch.outcome = {
          ...input,
          label:
            "Observed reduction / staff review; not independently verified savings",
          reviewedBy: req.user._id,
          at: new Date(),
        };
      const updated = await models.Recommendation.findOneAndUpdate(
        { _id: r._id, status: r.status },
        {
          $set: patch,
          $push: {
            history: {
              at: new Date(),
              action,
              actorId: req.user._id,
              reason: input.reason,
            },
          },
        },
        { returnDocument: "after" },
      ).lean();
      if (!updated)
        fail(409, "STATE_CHANGED", "Recommendation changed; reload");
      await audit(models, req.user._id, `recommendation.${action}`, r._id);
      res.json({ data: updated });
    });
  const supplyLimiter = rateLimit({
    windowMs: 60000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  api.post("/rooms/:id/supply-commands", supplyLimiter, async (req, res) => {
    responder(req.user);
    requireRoom(req.user, req.params.id);
    const input = commandInput.parse(req.body);
    if (input.reason !== "staff_override")
      fail(
        403,
        "INTERNAL_REASON",
        "Automatic and QR reasons are generated only by the backend",
      );
    res
      .status(202)
      .json({
        data: await adapter.setSupply(req.params.id, input, req.user._id),
      });
  });
  api.get("/commands/:id", async (req, res) => {
    const command = found(await models.Command.findById(req.params.id).lean());
    requireRoom(req.user, command.roomId);
    res.json({ data: command });
  });
  api.post("/rooms/:id/access-leases", supplyLimiter, async (req, res) => {
    staff(req.user);
    requireRoom(req.user, req.params.id);
    const input = leaseInput.parse(req.body);
    if (input.durationMinutes > config.qrMaxMinutes)
      fail(400, "DURATION_LIMIT", "Requested duration exceeds policy");
    const lease = await withRoomLock(models, req.params.id, async (room) => {
      const now = new Date(),
        expiresAt = new Date(
          now.getTime() + (input.durationMinutes * 60000) / config.timeScale,
        ),
        settings = await getSettings(models);
      const reason = accessAllowed(
        room,
        await models.Schedule.find({
          roomId: room._id,
          status: "confirmed",
        }).lean(),
        now,
        new Date(now.getTime() + input.durationMinutes * 60000),
        settings.timezone,
      );
      if (reason) fail(409, "ACCESS_DENIED", reason);
      const created = await models.AccessLease.create({
        ...input,
        roomId: room._id,
        requesterId: req.user._id,
        startAt: now,
        expiresAt,
      });
      try {
        await adapter.setSupply(
          room._id,
          {
            requestId: `lease-${created._id}`,
            action: "on",
            reason: "qr_access",
          },
          req.user._id,
          now,
          room,
        );
      } catch (err) {
        await models.AccessLease.updateOne(
          { _id: created._id },
          { $set: { endedAt: now } },
        );
        throw err;
      }
      await cancelRoomWork(models, room._id, "Authorised QR lease");
      return created;
    });
    await audit(models, req.user._id, "lease.create", lease._id);
    res.status(201).json({ data: lease });
  });
  for (const action of ["extend", "end"])
    api.post(
      `/access-leases/:id/${action}`,
      supplyLimiter,
      async (req, res) => {
        staff(req.user);
        const lease = found(
          await models.AccessLease.findById(req.params.id).lean(),
        );
        requireRoom(req.user, lease.roomId);
        if (lease.requesterId !== req.user._id && req.user.role !== "admin")
          fail(
            403,
            "LEASE_OWNER",
            "Only the requester or administrator can change this lease",
          );
        const result = await withRoomLock(
          models,
          lease.roomId,
          async (room) => {
            const current = found(
              await models.AccessLease.findById(lease._id).lean(),
            );
            if (current.endedAt || current.expiresAt < new Date())
              fail(409, "LEASE_EXPIRED", "Start a new authorised lease");
            if (action === "end") {
              await models.AccessLease.updateOne(
                { _id: lease._id },
                { $set: { endedAt: new Date() } },
              );
              return models.AccessLease.findById(lease._id).lean();
            }
            const input = leaseInput.parse(req.body),
              now = new Date(),
              expiresAt = new Date(
                now.getTime() +
                  (input.durationMinutes * 60000) / config.timeScale,
              );
            if (input.durationMinutes > config.qrMaxMinutes)
              fail(400, "DURATION_LIMIT", "Extension exceeds policy");
            const settings = await getSettings(models),
              reason = accessAllowed(
                room,
                await models.Schedule.find({
                  roomId: room._id,
                  status: "confirmed",
                }).lean(),
                now,
                new Date(now.getTime() + input.durationMinutes * 60000),
                settings.timezone,
              );
            if (reason) fail(409, "ACCESS_DENIED", reason);
            await models.AccessLease.updateOne(
              { _id: lease._id },
              {
                $set: {
                  expiresAt,
                  durationMinutes: input.durationMinutes,
                  warnedAt: null,
                  expiryHandledAt: null,
                },
                $inc: { revision: 1 },
              },
            );
            await cancelRoomWork(models, room._id, "QR lease extended");
            return models.AccessLease.findById(lease._id).lean();
          },
        );
        await audit(models, req.user._id, `lease.${action}`, lease._id);
        res.json({ data: result });
      },
    );
  api.post("/rooms/:id/overrides", async (req, res) => {
    staff(req.user);
    requireRoom(req.user, req.params.id);
    const input = z
      .object({
        reason: z.string().min(3).max(500),
        durationMinutes: z.number().int().min(1).max(120),
      })
      .strict()
      .parse(req.body);
    const override = await withRoomLock(models, req.params.id, async () => {
      const saved = await models.Override.create({
        roomId: req.params.id,
        creatorId: req.user._id,
        reason: input.reason,
        startAt: new Date(),
        expiresAt: new Date(
          Date.now() + (input.durationMinutes * 60000) / config.timeScale,
        ),
      });
      await cancelRoomWork(models, req.params.id, "Staff override");
      return saved;
    });
    await audit(models, req.user._id, "override.create", override._id);
    res.status(201).json({ data: override });
  });
  api.post("/overrides/:id/end", async (req, res) => {
    staff(req.user);
    const override = found(
      await models.Override.findById(req.params.id).lean(),
    );
    requireRoom(req.user, override.roomId);
    if (override.creatorId !== req.user._id && req.user.role !== "admin")
      fail(403, "OVERRIDE_OWNER", "Only creator or admin may end the override");
    await withRoomLock(models, override.roomId, () =>
      models.Override.updateOne(
        { _id: override._id },
        { $set: { endedAt: new Date() } },
      ),
    );
    res.json({ data: { ended: true } });
  });
  api.get("/notifications", async (req, res) =>
    res.json({
      data: await models.Notification.find(
        req.user.role === "admin" ? {} : { recipientId: req.user._id },
      )
        .sort({ createdAt: -1 })
        .limit(100)
        .lean(),
    }),
  );
  api.post("/notifications/:id/read", async (req, res) => {
    const n = found(await models.Notification.findById(req.params.id).lean());
    if (n.recipientId !== req.user._id && req.user.role !== "admin")
      fail(403, "FORBIDDEN", "Notification is outside your scope");
    await models.Notification.updateOne(
      { _id: n._id },
      { $set: { readAt: new Date() } },
    );
    res.json({ data: { read: true } });
  });
  api.get("/integrations", async (req, res) =>
    res.json({
      data: await models.Integration.find(
        req.user.role === "admin"
          ? {}
          : {
              $or: [
                { roomId: { $in: req.user.permittedRoomIds } },
                { roomId: { $exists: false } },
              ],
            },
      ).lean(),
    }),
  );
  api.post("/integrations", async (req, res) => {
    admin(req.user);
    const input = z
      .object({
        _id: id,
        roomId: id,
        type: z.enum(["camera", "presence", "meter"]),
        name: z.string().min(1).max(200),
        freshnessSeconds: z.number().min(1).max(300).default(120),
        coverageValidated: z.boolean().default(false),
        meterId: id.optional(),
      })
      .strict()
      .parse(req.body);
    found(await models.Room.findById(input.roomId).lean());
    const { meterId, ...fields } = input;
    const integration = await models.Integration.create({
      ...fields,
      health: "unavailable",
      capabilities: meterId ? { meterId } : {},
    });
    const token = createHmac("sha256", config.ingestToken)
      .update(integration._id)
      .digest("hex");
    await audit(models, req.user._id, "integration.create", integration._id);
    res.status(201).json({ data: { integration, serviceToken: token } });
  });
  api.patch("/integrations/:id", async (req, res) => {
    admin(req.user);
    const input = z
      .object({
        coverageValidated: z.boolean().optional(),
        freshnessSeconds: z.number().min(1).max(300).optional(),
        health: z.literal("unavailable").optional(),
      })
      .strict()
      .parse(req.body);
    const source = found(
      await models.Integration.findById(req.params.id).lean(),
    );
    const operation = async () => {
      await models.Integration.updateOne({ _id: source._id }, { $set: input });
      if (source.roomId)
        await cancelRoomWork(models, source.roomId, "Source policy changed");
    };
    if (source.roomId) await withRoomLock(models, source.roomId, operation);
    else await operation();
    await audit(models, req.user._id, "integration.update", source._id);
    res.json({ data: await models.Integration.findById(source._id).lean() });
  });
  api.post("/integrations/:id/test", async (req, res) => {
    admin(req.user);
    const source = found(
      await models.Integration.findById(req.params.id).lean(),
    );
    res.json({
      data: {
        id: source._id,
        health: source.health,
        available: source.health === "online",
        simulated: !!source.capabilities?.fixtureReplay,
        message:
          source.health === "online"
            ? "Recent observation available; verify coverage separately"
            : "Integration unavailable. Supply a supported, configured adapter; no successful physical connection is claimed.",
      },
    });
  });
  api.get("/audit-events", async (req, res) => {
    admin(req.user);
    res.json({
      data: await models.AuditEvent.find()
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    });
  });
  api.get("/rooms/:id/qr", async (req, res) => {
    staff(req.user);
    requireRoom(req.user, req.params.id);
    const room = found(await models.Room.findById(req.params.id).lean()),
      url = `${config.publicAppUrl}/access/${room.publicToken}`;
    res.json({
      data: {
        url,
        image: await QRCode.toDataURL(url),
        policy:
          "Login and server authorisation required; never a direct power-control URL",
      },
    });
  });
  api.post("/demo/scenarios/:scenario/start", async (req, res) => {
    admin(req.user);
    if (!config.demoMode) fail(404, "NOT_FOUND", "Demonstrations are disabled");
    const input = z.object({ roomId: id }).strict().parse(req.body),
      scenario = z
        .enum([
          "normal-class",
          "forgotten-lights",
          "person-returns",
          "camera-offline",
          "unknown-cause",
          "building-anomaly",
          "optimisation",
          "qr-access",
        ])
        .parse(req.params.scenario);
    const row = await withRoomLock(models, input.roomId, async (room) => {
      const demoScenario =
        scenario === "forgotten-lights"
          ? "vacant"
          : scenario === "camera-offline"
            ? "offline"
            : "occupied";
      if (
        [
          "normal-class",
          "forgotten-lights",
          "person-returns",
          "camera-offline",
        ].includes(scenario)
      ) {
        if (!room.requiredSourceIds.length)
          fail(
            409,
            "NO_SOURCE",
            "Choose a room with a mapped observation source",
          );
        await models.Room.updateOne(
          { _id: room._id },
          {
            $set: {
              demoScenario,
              demoUntil: new Date(Date.now() + 10 * 60000),
              controlMode: "simulated",
            },
          },
        );
        if (scenario === "forgotten-lights")
          await models.Breaker.updateOne(
            { _id: room.roomBreakerId },
            { $set: { reportedSupply: "on", automationDisabled: false } },
          );
        if (demoScenario !== "vacant")
          await cancelRoomWork(
            models,
            room._id,
            "Demonstration changed evidence",
          );
      }
      return {
        scenario,
        roomId: room._id,
        dataMode: "simulated",
        timeScale: config.timeScale,
        message:
          scenario === "qr-access"
            ? "Use the authenticated access form; this endpoint does not issue a lease."
            : scenario === "building-anomaly" ||
                scenario === "unknown-cause" ||
                scenario === "optimisation"
              ? "Review seeded synthetic analytics and recommendations; causes remain unconfirmed."
              : "Synthetic observation replay started for ten minutes; this is not camera inference.",
      };
    });
    await audit(models, req.user._id, "demo.scenario", input.roomId, scenario);
    res.json({ data: row });
  });
  api.post("/demo/reset", async (req, res) => {
    admin(req.user);
    if (!config.demoMode) fail(404, "NOT_FOUND", "Demonstrations are disabled");
    for (const room of await models.Room.find().lean())
      await withRoomLock(models, room._id, async () => {
        await models.Room.updateOne(
          { _id: room._id },
          {
            $unset: { demoScenario: "", demoUntil: "" },
            $set: { controlMode: "alert_only" },
            $inc: { policyVersion: 1 },
          },
        );
        await cancelRoomWork(models, room._id, "Demo stopped");
      });
    res.json({
      data: {
        message:
          "Fixture replay stopped; rooms are alert-only. Meter records and audit history preserved.",
      },
    });
  });
  app.use("/api/v1", api);
  app.use("/api", (req, res) => fail(404, "NOT_FOUND", "API route not found"));
  const frontend = fileURLToPath(
    new URL("../../frontend/dist/", import.meta.url),
  );
  if (existsSync(`${frontend}/index.html`)) {
    app.use(express.static(frontend));
    app.use((req, res, next) =>
      req.method === "GET" && req.accepts("html")
        ? res.sendFile(`${frontend}/index.html`)
        : next(),
    );
  }
  app.use((req, res) => fail(404, "NOT_FOUND", "Route not found"));
  app.use(errorHandler);
  const io = new Server(server, {
    cors: { origin: [...origins], credentials: true },
    allowRequest: (req, callback) =>
      callback(null, origins.has(req.headers.origin)),
  });
  io.engine.use(sessions);
  io.use(async (socket, next) => {
    try {
      const user = await models.User.findOne({
        _id: socket.request.session?.userId,
        active: true,
      }).lean();
      if (!user) return next(new Error("AUTH_REQUIRED"));
      socket.data.user = user;
      next();
    } catch {
      next(new Error("AUTH_REQUIRED"));
    }
  });
  io.on("connection", (socket) => {
    socket.on("subscribe-room", (roomId, ack) => {
      try {
        id.parse(roomId);
        requireRoom(socket.data.user, roomId);
        socket.join(`room:${roomId}`);
        if (typeof ack === "function") ack({ ok: true });
      } catch {
        if (typeof ack === "function")
          ack({ ok: false, error: "ROOM_FORBIDDEN" });
      }
    });
  });
  const interval = setInterval(() => {
    for (const socket of io.sockets.sockets.values())
      socket.request.session.reload(async (err) => {
        if (err) return socket.disconnect(true);
        const user = await models.User.findOne({
          _id: socket.request.session.userId,
          active: true,
        })
          .lean()
          .catch(() => null);
        if (!user) return socket.disconnect(true);
        socket.data.user = user;
        socket.emit("refresh", { serverTime: new Date().toISOString() });
      });
  }, 3000);
  interval.unref();
  return {
    app,
    server,
    io,
    store,
    close: async () => {
      clearInterval(interval);
      await new Promise((resolve) => io.close(resolve));
    },
  };
}
