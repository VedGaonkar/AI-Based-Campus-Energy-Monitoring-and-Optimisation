import { z } from "zod";
import { randomUUID, createHmac } from "node:crypto";
import { id, parsePatch } from "../../shared/contracts.js";
import { requireRole, fail, withRoomLock } from "./security/access.js";
import { audit, getSettings, cancelRoomWork, roomContext } from "./services/context.js";

const text = z.string().trim().min(1).max(200);
const buildingInput = z.object({
  installationName: text,
  organisationName: text,
  contactEmail: z.email().max(200),
  address: z.string().trim().max(500).default(""),
  buildingType: z.enum(["college", "school", "office", "hospital", "commercial", "other"]),
}).strict();
const floorInput = z.object({ name: text, code: id, order: z.number().int().min(-20).max(200).default(0) }).strict();
const requireRecord = (record) => { if (!record) fail(404, "NOT_FOUND", "Record not found"); return record; };

// These endpoints reuse the installation, rooms, sources and policy engine.
// There is one building per installation; no second set of control state exists.
export function registerManagement(api, { models, config }) {
  api.patch("/auth/profile", async (req, res) => {
    const input = z.object({ name: text }).strict().parse(req.body);
    await models.User.updateOne({ _id: req.user._id }, { $set: input });
    await audit(models, req.user._id, "auth.profile_updated", req.user._id);
    res.json({ data: { user: await models.User.findById(req.user._id).lean() } });
  });
  api.use("/management", (req, res, next) => { requireRole(req.user, ["admin"]); next(); });
  api.get("/management/building", async (req, res) => {
    const [building, floors, rooms] = await Promise.all([
      getSettings(models), models.Floor.find().sort({ order: 1, code: 1 }).lean(),
      models.Room.find().select("_id code name floorId spaceType cameraConfiguration roomBreakerId controlMode").sort({ code: 1 }).lean(),
    ]);
    res.json({ data: { building, floors, rooms } });
  });
  api.put("/management/building", async (req, res) => {
    const input = buildingInput.parse(req.body);
    await models.Settings.updateOne({ _id: "installation" }, { $set: { ...input, setupCompleted: true } }, { upsert: true });
    if (models.workspaceDirectory) await models.workspaceDirectory.rename(models.workspaceDirectory.current(), input.installationName);
    await audit(models, req.user._id, "building.save", "installation");
    res.json({ data: await getSettings(models) });
  });
  api.post("/management/floors", async (req, res) => {
    const input = floorInput.parse(req.body);
    const floor = await models.Floor.create(input);
    await audit(models, req.user._id, "floor.create", floor._id);
    res.status(201).json({ data: floor });
  });
  api.post("/management/floors/generate", async (req, res) => {
    const input = z.object({ count: z.number().int().min(1).max(30) }).strict().parse(req.body);
    const existing = await models.Floor.find().lean(), codes = new Set(existing.map((f) => f.code));
    const rows = [];
    for (let order = 0; rows.length < input.count; order++) {
      const code = `FL-${String(order).padStart(2, "0")}`;
      if (!codes.has(code)) rows.push({ _id: randomUUID(), code, order, name: order === 0 ? "Ground Floor" : `Floor ${order}` });
    }
    try { await models.Floor.insertMany(rows, { ordered: true, throwOnValidationError: true }); }
    catch (err) { await models.Floor.deleteMany({ _id: { $in: rows.map((r) => r._id) } }); throw err; }
    await audit(models, req.user._id, "floor.generate", "installation", `${rows.length} floors created`);
    res.status(201).json({ data: rows });
  });
  api.patch("/management/floors/:id", async (req, res) => {
    const input = parsePatch(floorInput, req.body);
    const floor = requireRecord(await models.Floor.findById(req.params.id).lean());
    await models.Floor.updateOne({ _id: floor._id }, { $set: input });
    await audit(models, req.user._id, "floor.update", floor._id);
    res.json({ data: await models.Floor.findById(floor._id).lean() });
  });
  api.post("/management/floors/:id/spaces", async (req, res) => {
    const floor = requireRecord(await models.Floor.findById(req.params.id).lean());
    const input = z.object({ count: z.number().int().min(1).max(100), prefix: id.max(15), startNumber: z.number().int().min(0).max(99999),
      spaceType: z.enum(["classroom", "laboratory", "office", "meeting", "washroom", "corridor", "other"]), capacity: z.number().int().min(0).max(10000) }).strict().parse(req.body);
    const names = { classroom: "Classroom", laboratory: "Laboratory", office: "Office", meeting: "Meeting Room", washroom: "Washroom", corridor: "Corridor", other: "Space" };
    const rows = Array.from({ length: input.count }, (_, index) => {
      const suffix = String(input.startNumber + index).padStart(3, "0");
      return { _id: randomUUID(), floorId: floor._id, name: `${names[input.spaceType]} ${suffix}`, code: `${input.prefix}-${suffix}`,
        capacity: input.capacity, spaceType: input.spaceType, cameraConfiguration: "none", roomBreakerId: `BRK-${randomUUID()}`, controlMode: "alert_only" };
    });
    if (await models.Room.exists({ code: { $in: rows.map((r) => r.code) } })) fail(409, "DUPLICATE", "Generated space codes overlap existing rooms. Change the prefix or starting number.");
    try {
      await models.Room.insertMany(rows, { ordered: true, throwOnValidationError: true });
      await models.Breaker.insertMany(rows.map((r) => ({ _id: r.roomBreakerId, roomId: r._id, adapter: "simulator", nativeDeviceId: r.roomBreakerId })), { ordered: true, throwOnValidationError: true });
    } catch (err) {
      await models.Room.deleteMany({ _id: { $in: rows.map((r) => r._id) } });
      await models.Breaker.deleteMany({ _id: { $in: rows.map((r) => r.roomBreakerId) } });
      throw err;
    }
    await audit(models, req.user._id, "space.generate", floor._id, `${rows.length} ${input.spaceType} spaces created`);
    res.status(201).json({ data: rows });
  });
  api.get("/management/controllers", async (req, res) => {
    res.json({ data: await models.Breaker.find().sort({ roomId: 1 }).lean() });
  });
  api.patch("/management/controllers/:id", async (req, res) => {
    const input = z.object({
      name: text.optional(), manufacturer: z.string().trim().max(200).optional(),
      model: z.string().trim().max(200).optional(), nativeDeviceId: text.optional(),
      installationVerified: z.boolean().optional(),
    }).strict().parse(req.body);
    const controller = requireRecord(await models.Breaker.findById(req.params.id).lean());
    await withRoomLock(models, controller.roomId, async () => {
      await models.Breaker.updateOne({ _id: controller._id }, { $set: input });
      await cancelRoomWork(models, controller.roomId, "Controller configuration changed");
    });
    await audit(models, req.user._id, "controller.update", controller._id);
    res.json({ data: await models.Breaker.findById(controller._id).lean() });
  });
  api.post("/management/controllers/:id/test", async (req, res) => {
    const controller = requireRecord(await models.Breaker.findById(req.params.id).lean());
    res.json({ data: { status: controller.health, simulated: true, reportedSupply: controller.reportedSupply,
      message: "Simulator adapter only. No physical connection or switching was tested." } });
  });
  api.post("/management/cameras", async (req, res) => {
    const input = z.object({
      name: text, roomId: id, connectionMethod: z.enum(["simulation", "gateway"]),
      coverageValidated: z.boolean().default(false),
    }).strict().parse(req.body);
    if (input.connectionMethod === "simulation" && !config.demoMode)
      fail(400, "DEMO_DISABLED", "Camera simulation requires demonstration mode");
    const result = await withRoomLock(models, input.roomId, async (room) => {
      const source = await models.Integration.create({
        type: "camera", name: input.name, roomId: room._id, health: "unavailable",
        coverageValidated: input.coverageValidated, freshnessSeconds: 120,
        capabilities: { fixtureReplay: input.connectionMethod === "simulation", connectionMethod: input.connectionMethod },
      });
      await models.Room.updateOne({ _id: room._id }, { $set: {
        cameraConfiguration: "installed", coverageValidated: false,
        requiredSourceIds: [...new Set([...room.requiredSourceIds, source._id])],
      }, $inc: { policyVersion: 1 } });
      await cancelRoomWork(models, room._id, "Camera mapping changed");
      return source;
    });
    await audit(models, req.user._id, "camera.create", result._id);
    const serviceToken = input.connectionMethod === "gateway" ? createHmac("sha256", config.ingestToken).update(`${models.institutionId ? `${models.institutionId}:` : ""}${result._id}`).digest("hex") : undefined;
    res.status(201).json({ data: { integration: result, ...(serviceToken ? { serviceToken } : {}) } });
  });
  api.get("/management/automation", async (req, res) => {
    const rooms = await models.Room.find().sort({ code: 1 }).lean();
    const [contexts, commands, jobs] = await Promise.all([
      Promise.all(rooms.map((room) => roomContext(models, room, config))),
      models.Command.find().sort({ createdAt: -1 }).limit(100).lean(),
      models.Job.find({ status: { $in: ["pending", "leased"] } }).sort({ dueAt: 1 }).limit(100).lean(),
    ]);
    res.json({ data: { rooms: contexts.map((c) => ({
      id: c.room._id, code: c.room.code, name: c.room.name, controlMode: c.room.controlMode,
      occupancy: c.observed, protectedBy: c.protectedBy, supply: c.breaker?.reportedSupply ?? "unknown",
      interlocks: c.breaker ? { faultTripped: c.breaker.faultTripped, maintenanceLocked: c.breaker.maintenanceLocked,
        manuallyIsolated: c.breaker.manuallyIsolated, interlocksKnown: c.breaker.interlocksKnown } : null,
    })), commands, jobs, simulated: true,
      policy: { vacancyMinutes: config.vacancyMs * config.timeScale / 60000,
        firstEscalationMinutes: config.firstEscalationMs * config.timeScale / 60000,
        finalAdditionalMinutes: config.finalAdditionalMs * config.timeScale / 60000 } } });
  });
}
