import express from "express";
import { rateLimit } from "express-rate-limit";
import { demoSessionInput, pairInput, pairRoleInput, frameInput, sceneInput, ackInput, demoSupplyInput, injectionInput } from "../../shared/phone-demo-contracts.js";
import { requireRole, requireRoom, fail } from "./security/access.js";
import { demoGrant, safeDemoSession } from "./services/phone-demo.js";

export function registerDemoPhoneRoutes(api, { models, config, service, origins }) {
  const phone = express.Router();
  const allowed = new Set([...origins, ...(config.demoPhoneOrigins ?? [])]);
  phone.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer");
    const origin = req.get("Origin");
    if (origin && !allowed.has(origin)) fail(403, "ORIGIN_REJECTED", "Phone origin is not allowed");
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin); res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    if (!["GET", "HEAD"].includes(req.method) && !allowed.has(req.get("Origin"))) fail(403, "ORIGIN_REJECTED", "Phone origin is not allowed");
    next();
  });
  phone.post("/pair", rateLimit({ windowMs: 60000, limit: config.env === "test" ? 200 : 20, standardHeaders: "draft-8", legacyHeaders: false }), async (req, res) => res.json({ data: await service.pair(pairInput.parse(req.body).code) }));
  phone.use(async (req, res, next) => {
    req.demoGrant = await demoGrant(models, config, req.get("Authorization")?.replace(/^Bearer /, "")); next();
  });
  const burst = rateLimit({ windowMs: 1000, limit: config.env === "test" ? 100 : 4, standardHeaders: "draft-8", legacyHeaders: false });
  phone.get("/state", async (req, res) => res.json({ data: await service.state(req.demoGrant) }));
  phone.get("/commands", async (req, res) => res.json({ data: await service.commands(req.demoGrant) }));
  phone.post("/frames", burst, async (req, res) => res.status(202).json({ data: await service.frame(req.demoGrant, frameInput.parse(req.body)) }));
  phone.post("/ack", burst, async (req, res) => res.json({ data: await service.ack(req.demoGrant, ackInput.parse(req.body)) }));
  phone.post("/scene", burst, async (req, res) => res.json({ data: await service.scene(req.demoGrant, sceneInput.parse(req.body)) }));
  phone.post("/master", burst, async (req, res) => res.status(202).json({ data: await service.manualSupply(req.demoGrant, demoSupplyInput.parse(req.body)) }));
  phone.post("/inject", burst, async (req, res) => res.status(202).json({ data: await service.inject(req.demoGrant, injectionInput.parse(req.body)) }));
  phone.post("/offline", async (req, res) => { await service.offline(req.demoGrant); res.json({ data: { offline: true } }); });
  api.use("/demo-phone", phone);
}

export function registerDemoAdminRoutes(api, { models, service }) {
  const admin = req => requireRole(req.user, ["admin"]);
  const scoped = async req => {
    const session = await models.DemoSession.findById(req.params.id).lean();
    if (!session) fail(404, "NOT_FOUND", "Demo session not found");
    requireRoom(req.user, session.roomId); return session;
  };
  api.get("/demo/sessions", async (req, res) => { admin(req); res.json({ data: (await models.DemoSession.find().sort({ createdAt: -1 }).limit(40).lean()).map(safeDemoSession) }); });
  api.get("/demo/available-rooms", async (req, res) => { admin(req); res.json({ data: await service.availableRooms() }); });
  api.post("/demo/sessions", async (req, res) => { admin(req); res.status(201).json({ data: await service.create(demoSessionInput.parse(req.body), req.user._id) }); });
  api.get("/demo/sessions/:id", async (req, res) => { admin(req); await scoped(req); res.json({ data: await service.details(req.params.id) }); });
  api.post("/demo/sessions/:id/pairing", async (req, res) => { admin(req); await scoped(req); res.json({ data: await service.issuePairing(req.params.id, pairRoleInput.parse(req.body).role, req.user._id) }); });
  api.post("/demo/sessions/:id/stop", async (req, res) => { admin(req); await scoped(req); res.json({ data: await service.stop(req.params.id, req.user._id) }); });
  api.post("/demo/sessions/:id/reset", async (req, res) => {
    admin(req); const session = await scoped(req);
    await service.stop(session._id, req.user._id);
    res.status(201).json({ data: await service.create({ roomId: session.roomId, visionMode: session.visionMode, coverageReviewed: true,
      vacancyConfirmationSeconds: session.vacancyConfirmationMs / 1000, durationMinutes: 60, allowManualControl: session.allowManualControl }, req.user._id) });
  });
  api.get("/demo/sessions/:id/frame", async (req, res) => {
    admin(req); await scoped(req);
    const row = await models.DemoSession.findOne({ _id: req.params.id, active: true, thumbnailExpiresAt: { $gt: new Date() } }).select("+thumbnail").lean();
    if (!row?.thumbnail) fail(404, "NO_FRAME", "No current retained thumbnail");
    res.setHeader("Cache-Control", "no-store"); res.type("image/jpeg").send(Buffer.from(row.thumbnail.buffer ?? row.thumbnail));
  });
}

export function registerDemoSockets(io, { models, config, service }) {
  const namespace = io.of("/demo-phone");
  namespace.use(async (socket, next) => {
    try { socket.data.grant = await demoGrant(models, config, socket.handshake.auth?.token); next(); }
    catch { next(new Error("PAIR_REQUIRED")); }
  });
  namespace.on("connection", socket => {
    socket.join(`demo:${socket.data.grant.sessionId}:${socket.data.grant.role}`);
    socket.on("demo:heartbeat", async () => {
      try { socket.data.grant = await demoGrant(models, config, socket.handshake.auth?.token); }
      catch { socket.disconnect(true); }
    });
    socket.on("disconnect", () => service.offline(socket.data.grant).catch(() => {}));
  });
  let running = false;
  const timer = setInterval(async () => {
    if (running) return; running = true;
    try {
      for (const socket of namespace.sockets.values()) {
        try {
          const grant = await demoGrant(models, config, socket.handshake.auth?.token, new Date(), false);
          socket.emit("demo:state", await service.state(grant));
          for (const command of await service.commands(grant)) socket.emit("demo:command", command);
        } catch (error) { if (error.code !== "ROOM_BUSY") socket.disconnect(true); }
      }
    } finally { running = false; }
  }, 1000);
  timer.unref();
  return () => { clearInterval(timer); namespace.disconnectSockets(true); };
}
