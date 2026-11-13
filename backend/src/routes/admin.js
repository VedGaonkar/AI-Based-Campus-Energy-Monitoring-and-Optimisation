import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { now } from '../clock.js';
import { adapterStatus, getRoomMasterAdapter } from '../adapters/roomMaster.js';
import { AuditEvent, Integration, ROLES, Room, RoomBreaker, Schedule, User } from '../models/index.js';
import { isObjectId, requireAuth, requireRole, requireService, validate } from '../security/auth.js';
import { ApiError, audit, badRequest, conflict, emitLive, forbidden, getSettings, notFound } from '../services/core.js';
import { ingestReadings } from '../services/meterIngest.js';
import { ingestObservation } from '../services/occupancy.js';
import { getProtection } from '../services/roomState.js';
import { seedDemo } from '../seed/index.js';
import { userView } from './auth.js';

export const adminRouter = Router();
const oid = z.string().refine(isObjectId, 'must be a valid id');

// ---- installation settings ----
const settingsView = (s) => {
  const o = s.toObject();
  delete o._id;
  delete o.__v;
  delete o.key;
  return o;
};

adminRouter.get('/settings', requireAuth, async (_req, res) => {
  res.json({ settings: settingsView(await getSettings()) });
});

const num = (min, max) => z.number().min(min).max(max);
const settingsBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    meterId: z.string().trim().min(1).max(50),
    tariffPerKwh: num(0, 1000),
    tariffIsHypothetical: z.boolean(),
    holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(400),
    energyResponderIds: z.array(oid).max(20),
    policies: z
      .object({
        vacancyConfirmationMinutes: num(1, 240),
        firstEscalationMinutes: num(1, 240),
        finalEscalationAdditionalMinutes: num(1, 240),
        bookingPreparationMinutes: num(0, 120),
        qrMaxDurationMinutes: num(5, 720),
        qrExpiryWarningMinutes: num(1, 120),
        observationFreshnessSeconds: num(5, 3600),
        snoozeMaxMinutes: num(1, 240),
        accessStartHour: num(0, 23),
        accessEndHour: num(1, 24),
        commandExpirySeconds: num(5, 300),
      })
      .partial(),
    anomaly: z
      .object({
        minSamples: num(3, 100),
        absoluteExcessFloorKwh: num(0, 10000),
        relativeThreshold: num(0, 10),
        trainingWindowDays: num(7, 365),
        maxSupplyKw: num(1, 100000),
        expectedCadenceMinutes: num(1, 1440),
        essentialLoadKw: num(0, 100000),
        initialRule: z.object({ enabled: z.boolean(), teachingHourKwh: num(0, 100000), offHourKwh: num(0, 100000) }).partial(),
      })
      .partial(),
    budget: z.record(z.string(), num(0, 1e9)),
  })
  .partial();

adminRouter.patch('/settings', requireRole('admin'), async (req, res) => {
  const body = validate(settingsBody, req.body);
  const settings = await getSettings();
  const { policies, anomaly, budget, ...top } = body;
  Object.assign(settings, top);
  if (policies) Object.assign(settings.policies, policies);
  if (anomaly) {
    const { initialRule, ...rest } = anomaly;
    Object.assign(settings.anomaly, rest);
    if (initialRule) Object.assign(settings.anomaly.initialRule, initialRule);
  }
  if (budget) {
    for (const [k, v] of Object.entries(budget)) if (k in settings.budget.toObject()) settings.budget[k] = v;
  }
  await settings.save();
  await audit(req.user, 'settings.update', 'settings', settings._id, body);
  res.json({ settings: settingsView(settings) });
});

// ---- users ----
adminRouter.get('/users', requireRole('admin', 'hod'), async (_req, res) => {
  res.json({ users: (await User.find().sort({ name: 1 })).map(userView) });
});

const userBody = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
  role: z.enum(ROLES),
  department: z.string().trim().max(100).optional(),
  permittedRoomIds: z.array(oid).max(200).optional(),
  active: z.boolean().optional(),
});

adminRouter.post('/users', requireRole('admin'), async (req, res) => {
  const { password, ...body } = validate(userBody, req.body);
  if (await User.exists({ email: body.email })) throw conflict('duplicate_email', 'A user with this email already exists');
  const user = await User.create({ ...body, passwordHash: await bcrypt.hash(password, 10) });
  await audit(req.user, 'user.create', 'user', user._id, body);
  res.status(201).json({ user: userView(user) });
});

adminRouter.patch('/users/:id', requireRole('admin'), async (req, res) => {
  const { password, ...body } = validate(userBody.partial(), req.body);
  const user = isObjectId(req.params.id) && (await User.findById(req.params.id));
  if (!user) throw notFound('User');
  if (String(user._id) === String(req.user._id) && (body.active === false || (body.role && body.role !== 'admin'))) {
    throw badRequest('self_lockout', 'You cannot deactivate or demote your own account');
  }
  Object.assign(user, body);
  if (password) user.passwordHash = await bcrypt.hash(password, 10);
  await user.save();
  await audit(req.user, 'user.update', 'user', user._id, { ...body, password: password ? 'changed' : undefined });
  res.json({ user: userView(user) });
});

// ---- integrations ----
const integrationView = (i) => ({
  id: String(i._id),
  sourceId: i.sourceId,
  type: i.type,
  name: i.name ?? null,
  roomId: i.roomId ? String(i.roomId) : null,
  enabled: i.enabled,
  dataMode: i.dataMode,
  capabilities: i.capabilities ?? [],
  lastSeenAt: i.lastSeenAt ?? null,
  health: i.health,
  lastTest: i.lastTest?.at ? i.lastTest : null,
});

// Optional services that are not wired up are listed honestly as unavailable.
function builtInIntegrations() {
  const cfg = config();
  const a = adapterStatus();
  return [
    { id: 'builtin:simulator', sourceId: 'room-master-simulator', type: 'room_breaker', name: 'Room-master simulator', health: 'connected', dataMode: 'simulated', enabled: true, builtIn: true, detail: 'Simulated switching only; nothing physical is controlled' },
    { id: 'builtin:physical', sourceId: 'room-master-physical', type: 'room_breaker', name: 'Physical smart breaker adapter', health: 'unavailable', enabled: false, builtIn: true, detail: a.physical.reason },
    { id: 'builtin:vision', sourceId: 'vision-service', type: 'vision_service', name: 'Vision / OCR service', health: cfg.visionBaseUrl ? 'not_configured' : 'unavailable', enabled: Boolean(cfg.visionBaseUrl), builtIn: true, detail: cfg.visionBaseUrl ? `Configured at ${cfg.visionBaseUrl}; run a test to check it` : 'VISION_BASE_URL is not set. Manual and CSV meter entry still work.' },
    { id: 'builtin:smtp', sourceId: 'smtp', type: 'smtp', name: 'Email (SMTP)', health: 'unavailable', enabled: false, builtIn: true, detail: 'Not implemented. Notifications are delivered in-app.' },
    { id: 'builtin:mqtt', sourceId: 'mqtt', type: 'mqtt', name: 'MQTT broker', health: 'unavailable', enabled: false, builtIn: true, detail: 'Not implemented. Sources post to the HTTP ingestion endpoints.' },
  ];
}

adminRouter.get('/integrations', requireRole('admin', 'hod', 'first_responder'), async (_req, res) => {
  const settings = await getSettings();
  const freshMs = settings.policies.observationFreshnessSeconds * 1000;
  const sources = (await Integration.find().sort({ sourceId: 1 }).lean()).map((i) => ({
    ...integrationView(i),
    // Stored health is the last report; a silent source is degraded regardless.
    health: !i.enabled ? 'not_configured' : i.lastSeenAt && now() - i.lastSeenAt <= freshMs ? 'connected' : i.lastSeenAt ? 'degraded' : 'not_configured',
  }));
  res.json({ integrations: [...builtInIntegrations(), ...sources] });
});

adminRouter.post('/integrations', requireRole('admin'), async (req, res) => {
  const body = validate(z.object({ sourceId: z.string().trim().min(1).max(60), type: z.enum(['camera', 'presence_sensor', 'meter_camera']), name: z.string().max(100).optional(), roomId: oid.optional(), dataMode: z.enum(['live', 'replay', 'simulated']).default('simulated') }), req.body);
  if (await Integration.exists({ sourceId: body.sourceId })) throw conflict('duplicate_source', 'A source with this ID already exists');
  if (config().demoMode && body.dataMode === 'live') throw conflict('demo_mode', 'Live sources cannot be registered in demonstration mode');
  const integration = await Integration.create(body);
  await audit(req.user, 'integration.create', 'integration', integration._id, body);
  res.status(201).json({ integration: integrationView(integration) });
});

adminRouter.patch('/integrations/:id', requireRole('admin'), async (req, res) => {
  const body = validate(z.object({ name: z.string().max(100), roomId: oid.nullable(), enabled: z.boolean(), dataMode: z.enum(['live', 'replay', 'simulated']) }).partial(), req.body);
  const integration = isObjectId(req.params.id) && (await Integration.findById(req.params.id));
  if (!integration) throw notFound('Integration');
  if (config().demoMode && body.dataMode === 'live') throw conflict('demo_mode', 'Live sources cannot be enabled in demonstration mode');
  Object.assign(integration, body);
  await integration.save();
  await audit(req.user, 'integration.update', 'integration', integration._id, body);
  res.json({ integration: integrationView(integration) });
});

adminRouter.post('/integrations/:id/test', requireRole('admin'), async (req, res) => {
  const cfg = config();
  const id = req.params.id;
  let result;
  if (id === 'builtin:simulator') result = { ok: true, message: 'Simulator is available. Results are simulated, not physical.' };
  else if (id === 'builtin:physical') result = { ok: false, message: adapterStatus().physical.reason };
  else if (id === 'builtin:smtp' || id === 'builtin:mqtt') result = { ok: false, message: 'This integration is not implemented.' };
  else if (id === 'builtin:vision') {
    if (!cfg.visionBaseUrl) result = { ok: false, message: 'VISION_BASE_URL is not set.' };
    else {
      try {
        const r = await fetch(`${cfg.visionBaseUrl}/health`, { signal: AbortSignal.timeout(5000) });
        const body = await r.json();
        result = { ok: r.ok, message: r.ok ? `Reachable. ${JSON.stringify(body)}` : `Service answered ${r.status}` };
      } catch (err) {
        result = { ok: false, message: `Not reachable: ${err.message}` };
      }
    }
  } else {
    const integration = isObjectId(id) && (await Integration.findById(id));
    if (!integration) throw notFound('Integration');
    const settings = await getSettings();
    const fresh = integration.lastSeenAt && now() - integration.lastSeenAt <= settings.policies.observationFreshnessSeconds * 1000;
    result = {
      ok: Boolean(fresh),
      message: fresh ? `Last event received ${integration.lastSeenAt.toISOString()} (${integration.dataMode})` : integration.lastSeenAt ? `No event since ${integration.lastSeenAt.toISOString()}; the source is stale` : 'No event has ever been received from this source',
    };
    integration.lastTest = { at: now(), ...result };
    await integration.save();
  }
  await audit(req.user, 'integration.test', 'integration', id, result);
  res.json({ test: { at: now(), ...result } });
});

adminRouter.get('/rooms/:id/breaker/test', requireRole('admin'), async (req, res) => {
  const breaker = isObjectId(req.params.id) && (await RoomBreaker.findOne({ roomId: req.params.id }));
  if (!breaker) throw notFound('Room master');
  const adapter = getRoomMasterAdapter(breaker);
  res.json({ adapter: adapter.name, capabilities: await adapter.getCapabilities(breaker), status: await adapter.getStatus(breaker) });
});

// ---- audit ----
adminRouter.get('/audit-events', requireRole('admin'), async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const events = await AuditEvent.find().sort({ at: -1 }).limit(limit).lean();
  res.json({ events: events.map((e) => ({ id: String(e._id), at: e.at, actor: e.actorLabel, action: e.action, targetType: e.targetType ?? null, targetId: e.targetId ?? null, detail: e.detail ?? null })) });
});

// ---- telemetry ingestion (service credential) ----
const observationBody = z.object({
  eventId: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(60),
  capturedAt: z.string(),
  occupancy: z.enum(['occupied', 'vacant', 'unknown']),
  detectedPeople: z.number().int().min(0).max(10000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  coverageValidated: z.boolean().optional(),
  quality: z.object({ usable: z.boolean(), reason: z.string().max(200).nullable().optional() }).optional(),
  equipmentOn: z.boolean().nullable().optional(),
  dataMode: z.enum(['live', 'replay', 'simulated']),
  modelVersion: z.string().max(100).optional(),
});

adminRouter.post('/ingest/observations', requireService, async (req, res) => {
  const body = validate(observationBody.passthrough(), req.body);
  res.status(202).json(await ingestObservation(body));
});

adminRouter.post('/ingest/meter-readings', requireService, async (req, res) => {
  const body = validate(
    z.object({
      eventId: z.string().min(1).max(200),
      meterId: z.string().min(1).max(50),
      capturedAt: z.string(),
      kind: z.literal('cumulative'),
      register: z.string(),
      value: z.number().min(0),
      unit: z.literal('kWh'),
      sourceType: z.enum(['camera_ocr', 'telemetry']),
      dataMode: z.enum(['live', 'replay', 'simulated']),
      quality: z.record(z.string(), z.any()).optional(),
      rawText: z.string().max(200).optional(),
    }),
    req.body,
  );
  const result = await ingestReadings([body], { sourceType: body.sourceType, dataMode: config().demoMode && body.dataMode === 'live' ? 'simulated' : body.dataMode, commit: true });
  await emitLive('energy.updated');
  const state = result.summary.accepted ? 'accepted' : result.summary.needsReview ? 'needs_review' : result.summary.duplicates ? 'duplicate' : 'rejected';
  res.status(202).json({ validation: state, reason: result.needsReview[0]?.reason ?? result.invalid[0]?.reason ?? null });
});

// Reported breaker health and interlock state. This never changes the commanded supply.
adminRouter.post('/ingest/device-events', requireService, async (req, res) => {
  const body = validate(
    z.object({
      eventId: z.string().min(1).max(200),
      roomBreakerId: z.string().min(1).max(30),
      capturedAt: z.string(),
      health: z.enum(['online', 'offline']).optional(),
      interlocks: z.object({ faultTripped: z.boolean(), maintenanceLock: z.boolean(), manualIsolation: z.boolean() }).partial().optional(),
      reportedSupply: z.enum(['on', 'off']).optional(),
    }),
    req.body,
  );
  const breaker = await RoomBreaker.findOne({ code: body.roomBreakerId.toUpperCase() });
  if (!breaker) throw notFound('Room master');
  if (body.health) breaker.health = body.health;
  if (body.interlocks) Object.assign(breaker.interlocks, body.interlocks);
  if (body.reportedSupply && body.reportedSupply !== breaker.supplyState) {
    breaker.supplyState = body.reportedSupply;
    // A state the application did not command is treated as manual: it is never auto-restored.
    breaker.offReason = body.reportedSupply === 'off' ? 'manual' : null;
    breaker.lastChangedAt = now();
  }
  breaker.lastSeenAt = now();
  await breaker.save();
  await emitLive('room.updated', { roomId: breaker.roomId });
  res.status(202).json({ ok: true });
});

// ---- demo only ----
function requireDemo(_req, _res, next) {
  if (!config().demoMode) throw forbidden('Demo endpoints are disabled outside demonstration mode');
  next();
}

async function simulate(roomCode, fields) {
  const room = await Room.findOne({ code: roomCode });
  if (!room) throw notFound(`Room ${roomCode}`);
  const source = await Integration.findOne({ roomId: room._id, type: { $in: ['camera', 'presence_sensor'] } });
  if (!source) throw new ApiError(409, 'no_source', `${roomCode} has no camera or presence source to simulate`);
  return ingestObservation(
    { eventId: `demo-${randomUUID()}`, sourceId: source.sourceId, capturedAt: now().toISOString(), coverageValidated: true, quality: { usable: true }, modelVersion: 'demo-fixture', dataMode: 'simulated', ...fields },
    { forceDataMode: 'simulated' },
  );
}

const SCENARIOS = {
  'normal-class': async () => {
    const room = await Room.findOne({ code: 'R101' });
    await Schedule.create({ roomId: room._id, startAt: now(), endAt: new Date(now().getTime() + 3_600_000), title: 'Demo lecture', origin: 'fixture' });
    return simulate('R101', { occupancy: 'occupied', detectedPeople: 24, confidence: 0.93, equipmentOn: true });
  },
  'forgotten-lights': async () => {
    const room = await Room.findOne({ code: 'R102' });
    const settings = await getSettings();
    const protection = await getProtection(room._id, now(), settings);
    // Demo only: clear anything that would protect the room so the scenario is repeatable at any hour.
    for (const r of protection.reasons.filter((x) => x.kind === 'schedule')) {
      await Schedule.updateOne({ _id: r.id }, { $set: { status: 'cancelled', cancelledAt: now(), cancelReason: 'Cancelled by demo scenario' } });
    }
    await RoomBreaker.updateOne({ roomId: room._id }, { $set: { supplyState: 'on', offReason: null } });
    return simulate('R102', { occupancy: 'vacant', detectedPeople: 0, confidence: 0.9, equipmentOn: true });
  },
  'person-returns': async () => simulate('R102', { occupancy: 'occupied', detectedPeople: 1, confidence: 0.88, equipmentOn: true }),
  'camera-offline': async () => simulate('R102', { occupancy: 'unknown', quality: { usable: false, reason: 'camera_offline' } }),
  'bad-meter-image': async () => {
    const settings = await getSettings();
    return ingestReadings(
      [{ meterId: settings.meterId, capturedAt: now().toISOString(), value: 1, register: 'import_kwh', rawText: '0000?1', quality: { ocrConfidence: 0.41, registerMatched: false, burstAgreement: false } }],
      { sourceType: 'camera_ocr', dataMode: 'simulated', commit: true },
    );
  },
};

adminRouter.get('/demo/scenarios', requireRole('admin'), requireDemo, (_req, res) => {
  res.json({ scenarios: Object.keys(SCENARIOS) });
});

adminRouter.post('/demo/scenarios/:id/start', requireRole('admin'), requireDemo, async (req, res) => {
  const scenario = SCENARIOS[req.params.id];
  if (!scenario) throw notFound('Scenario');
  const result = await scenario();
  await audit(req.user, 'demo.scenario', 'scenario', req.params.id);
  await emitLive('energy.updated');
  res.json({ scenario: req.params.id, dataMode: 'simulated', result });
});

adminRouter.post('/demo/observations', requireRole('admin'), requireDemo, async (req, res) => {
  const body = validate(z.object({ roomCode: z.string(), occupancy: z.enum(['occupied', 'vacant', 'unknown']), usable: z.boolean().default(true), equipmentOn: z.boolean().nullable().optional() }), req.body);
  const result = await simulate(body.roomCode.toUpperCase(), {
    occupancy: body.occupancy,
    equipmentOn: body.equipmentOn ?? null,
    quality: { usable: body.usable, reason: body.usable ? null : 'camera_offline' },
  });
  res.json({ dataMode: 'simulated', result });
});

adminRouter.post('/demo/reset', requireRole('admin'), requireDemo, async (req, res) => {
  const summary = await seedDemo();
  await new Promise((resolve) => req.session.destroy(() => resolve()));
  res.json({ ok: true, summary, note: 'Demo data was reset. Sign in again.' });
});
