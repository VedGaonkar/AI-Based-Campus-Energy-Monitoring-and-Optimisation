import { rateLimit } from "express-rate-limit";
import { connectionInput, connectionPatch, entityInput, reviewInput, permissionInput, nativeOffInput, simulationInput } from "../../shared/native-contracts.js";
import { requireRole, requireRoom, scope, fail } from "./security/access.js";
import { getConnectedDeviceService, publicConnection } from "./services/connected-devices.js";

export function registerConnectedDevices(api, { models, config }) {
  const service = getConnectedDeviceService(models, config);
  const admin = (user) => requireRole(user, ["admin"]);
  const target = async (req) => {
    const row = await models.ConnectedDevice.findById(req.params.id).lean();
    if (!row) fail(404, "NOT_FOUND", "Connected device not found");
    requireRoom(req.user, row.roomId); return row;
  };
  const limiter = rateLimit({ windowMs: 60000, limit: config.env === "test" ? 1000 : 30, standardHeaders: "draft-8", legacyHeaders: false,
    handler: (req, res) => res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many gateway operations. Wait before retrying.", requestId: req.requestId } }) });
  api.use("/device-connections", (req, res, next) => req.method === "GET" && !req.path.endsWith("/entities") ? next() : limiter(req, res, next));
  api.get("/device-connections", async (req, res) => {
    admin(req.user);
    const rows = await models.DeviceConnection.find().sort({ createdAt: -1 }).limit(100).lean();
    const result = await Promise.all(rows.map(async (row) => ({ ...publicConnection(row), affectedDevices: await models.ConnectedDevice.countDocuments({ connectionId: row._id, enabled: true }) })));
    res.json({ data: result });
  });
  api.post("/device-connections", async (req, res) => { admin(req.user); res.status(201).json({ data: await service.createConnection(connectionInput.parse(req.body), req.user._id) }); });
  api.patch("/device-connections/:id", async (req, res) => { admin(req.user); res.json({ data: await service.updateConnection(req.params.id, connectionPatch.parse(req.body), req.user._id) }); });
  api.post("/device-connections/:id/test", async (req, res) => { admin(req.user); res.json({ data: await service.testConnection(req.params.id) }); });
  api.get("/device-connections/:id/entities", async (req, res) => { admin(req.user); res.json({ data: await service.discover(req.params.id) }); });
  api.post("/device-connections/:id/live-permission", async (req, res) => { admin(req.user); res.json({ data: await service.setLivePermission(req.params.id, permissionInput.parse(req.body).enabled, req.user._id) }); });
  api.post("/device-connections/:id/simulation", async (req, res) => {
    admin(req.user); const { entityId, ...input } = simulationInput.parse(req.body);
    res.json({ data: await service.simulateState(req.params.id, entityId, input) });
  });
  api.get("/connected-devices", async (req, res) => res.json({ data: await models.ConnectedDevice.find(scope(req.user)).sort({ name: 1 }).limit(500).lean() }));
  api.post("/connected-devices", async (req, res) => { admin(req.user); res.status(201).json({ data: await service.register(entityInput.parse(req.body), req.user._id) }); });
  api.get("/connected-devices/:id", async (req, res) => res.json({ data: await target(req) }));
  api.post("/connected-devices/:id/refresh", limiter, async (req, res) => { const row = await target(req); requireRole(req.user, ["admin", "hod", "technician"]); await service.refreshTarget(row); res.json({ data: await models.ConnectedDevice.findById(row._id).lean() }); });
  api.patch("/connected-devices/:id/review", async (req, res) => { admin(req.user); await target(req); res.json({ data: await service.review(req.params.id, reviewInput.parse(req.body), req.user._id) }); });
  api.patch("/connected-devices/:id/binding", async (req, res) => { admin(req.user); await target(req); res.json({ data: await service.rebind(req.params.id, entityInput.parse(req.body), req.user._id) }); });
  api.post("/connected-devices/:id/automation", async (req, res) => { admin(req.user); await target(req); res.json({ data: await service.setAutomatic(req.params.id, permissionInput.parse(req.body).enabled, req.user._id) }); });
  api.post("/connected-devices/:id/unregister", async (req, res) => { admin(req.user); await target(req); res.json({ data: await service.unregister(req.params.id, req.user._id) }); });
  api.post("/connected-devices/:id/off", limiter, async (req, res) => {
    requireRole(req.user, ["admin", "hod", "technician"]); await target(req);
    const input = nativeOffInput.parse(req.body);
    res.status(202).json({ data: await service.requestOff(req.params.id, input.requestId, req.user._id) });
  });
  api.get("/connected-devices/:id/commands", async (req, res) => { await target(req); res.json({ data: await models.NativeCommand.find({ deviceId: req.params.id }).sort({ createdAt: -1 }).limit(100).lean() }); });
  return service;
}
