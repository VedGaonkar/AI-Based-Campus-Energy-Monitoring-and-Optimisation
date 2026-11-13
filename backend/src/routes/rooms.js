import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { config } from '../config.js';
import { now, policyMs } from '../clock.js';
import { adapterStatus } from '../adapters/roomMaster.js';
import { AccessLease, Command, Device, Incident, Override, Room, RoomBreaker, Schedule, User } from '../models/index.js';
import { commandBlocks, sharedCutoffBlocks } from '../policies/index.js';
import { canViewRoom, commandLimiter, isObjectId, leaseLimiter, requireAuth, requireRole, requireRoomView, validate } from '../security/auth.js';
import { commandResultView, issueSupplyCommand } from '../services/commands.js';
import { audit, badRequest, conflict, emitLive, forbidden, getSettings, notFound } from '../services/core.js';
import { closeIncident } from '../services/incidents.js';
import { canUseRoom, createLease, createOverride, endLease, endOverride, extendLease } from '../services/leases.js';
import { parseCsv } from '../services/meterIngest.js';
import { getRoomContext } from '../services/roomState.js';
import { parseIsoDate } from '../util/time.js';

export const roomsRouter = Router();
const oid = z.string().refine(isObjectId, 'must be a valid id');
const nullableOid = oid.nullable().optional();

function leaseView(l) {
  return l && { id: String(l._id), roomId: String(l.roomId), requesterId: String(l.requesterId), startAt: l.startAt, expiresAt: l.expiresAt, status: l.status, warningSentAt: l.warningSentAt ?? null, extensions: l.extensions?.length ?? 0, dataMode: l.dataMode };
}

function breakerView(b) {
  return (
    b && {
      id: String(b._id),
      code: b.code,
      adapter: b.adapter,
      supplyState: b.supplyState,
      offReason: b.offReason,
      interlocks: b.interlocks,
      health: b.health,
      lastChangedAt: b.lastChangedAt ?? null,
      lastVerification: b.lastVerification,
      minCycleSeconds: b.minCycleSeconds,
      feederCoverage: b.feederCoverage ?? null,
      verifiedRatings: b.verifiedRatings ?? null,
      nativeDeviceId: b.nativeDeviceId ?? null,
      simulator: b.simulator,
      sourceLabel: b.adapter === 'simulator' ? 'Simulated' : 'Sensor-reported',
    }
  );
}

function roomView(r) {
  return {
    id: String(r._id),
    code: r.code,
    name: r.name,
    capacity: r.capacity ?? null,
    zoneType: r.zoneType,
    assignments: {
      firstResponderId: r.assignments?.firstResponderId ? String(r.assignments.firstResponderId) : null,
      backupResponderId: r.assignments?.backupResponderId ? String(r.assignments.backupResponderId) : null,
      secondResponderId: r.assignments?.secondResponderId ? String(r.assignments.secondResponderId) : null,
    },
    occupancySource: r.occupancySource,
    coverageValidated: r.coverageValidated,
    coverageNotes: r.coverageNotes ?? null,
    controlMode: r.controlMode,
    autoControlEnabled: r.autoControlEnabled,
    qrExpiryPolicy: r.qrExpiryPolicy,
    policyVersion: r.policyVersion,
  };
}

export async function roomStatus(roomId) {
  const at = now();
  const ctx = await getRoomContext(roomId, at);
  if (!ctx) throw notFound('Room');
  const { room, breaker, devices, occupancy, protection, settings } = ctx;
  const [nextSchedule, lease, incident] = await Promise.all([
    Schedule.findOne({ roomId, status: 'confirmed', endAt: { $gt: at } }).sort({ startAt: 1 }).lean(),
    AccessLease.findOne({ roomId, status: 'active', expiresAt: { $gt: at } }).lean(),
    Incident.findOne({ roomId, active: true }).sort({ openedAt: -1 }).lean(),
  ]);
  const cfg = config();
  const blocks = (action, reason) =>
    breaker ? commandBlocks({ room, breaker, devices, occupancy, protection, cfg, at, action, reason, withinAccessHours: ctx.withinAccessHours, policyMsFn: policyMs }) : ['No room master is mapped to this room'];
  return {
    room: roomView(room),
    // Four separate facts: observed occupancy, authorised use, reported supply, appliance evidence.
    occupancy: {
      state: occupancy.state,
      reason: occupancy.reason,
      confirmedVacant: occupancy.confirmedVacant,
      fresh: occupancy.fresh,
      lastObservationAt: room.occupancy?.lastObservationAt ?? null,
      vacantSince: occupancy.vacantSince ?? null,
      dataMode: occupancy.dataMode,
      sourceLabel: occupancy.state === 'unknown' ? 'Unknown' : occupancy.dataMode !== 'live' ? 'Simulated' : room.occupancySource === 'camera' ? 'Camera-observed' : 'Sensor-reported',
      vacancyConfirmationMs: policyMs(settings.policies.vacancyConfirmationMinutes),
    },
    protection,
    nextSchedule: nextSchedule && { id: String(nextSchedule._id), title: nextSchedule.title, startAt: nextSchedule.startAt, endAt: nextSchedule.endAt },
    lease: leaseView(lease),
    breaker: breakerView(breaker),
    applianceEvidence: { equipmentOn: room.occupancy?.equipmentOn ?? null, observedAt: room.occupancy?.lastObservationAt ?? null, note: 'A visual impression only; it is not consumption telemetry' },
    devices: devices.map((d) => ({ ...d, id: String(d._id), _id: undefined, roomId: String(d.roomId) })),
    sharedCutoffBlocks: sharedCutoffBlocks(devices, breaker, at, policyMs),
    control: { offBlocks: blocks('off', 'manual'), onBlocks: blocks('on', 'manual') },
    incident: incident && { id: String(incident._id), type: incident.type, state: incident.state, title: incident.title, escalateDueAt: incident.escalateDueAt ?? null, finalDueAt: incident.finalDueAt ?? null, snoozedUntil: incident.snoozedUntil ?? null, blockReason: incident.blockReason ?? null },
    serverTime: at,
  };
}

// ---- rooms ----
roomsRouter.get('/rooms', requireAuth, async (req, res) => {
  const rooms = (await Room.find().sort({ code: 1 })).filter((r) => canViewRoom(req.user, r._id));
  const out = [];
  for (const r of rooms) {
    const s = await roomStatus(r._id);
    out.push({ ...s.room, occupancy: s.occupancy, protected: s.protection.protected, breaker: s.breaker, incident: s.incident, lease: s.lease });
  }
  res.json({ rooms: out });
});

const roomBody = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  capacity: z.number().int().positive().optional(),
  zoneType: z.enum(['room', 'common_area']).optional(),
  occupancySource: z.enum(['camera', 'presence_sensor', 'none']).optional(),
  coverageValidated: z.boolean().optional(),
  coverageNotes: z.string().max(500).optional(),
  controlMode: z.enum(['alert_only', 'simulated', 'physical']).optional(),
  autoControlEnabled: z.boolean().optional(),
  qrExpiryPolicy: z.enum(['staff_confirmation', 'fixed_duration_cutoff']).optional(),
});

function assertControlAllowed(body) {
  if (body.controlMode === 'physical') {
    const c = config();
    if (c.demoMode || !c.allowPhysicalControl) throw conflict('physical_control_disabled', 'Physical control is not armed on this server');
  }
}

roomsRouter.post('/rooms', requireRole('admin'), async (req, res) => {
  const body = validate(roomBody, req.body);
  assertControlAllowed(body);
  if (await Room.exists({ code: body.code.toUpperCase() })) throw conflict('duplicate_code', 'A room with this code already exists');
  const room = await Room.create({ ...body, qrPublicToken: randomBytes(18).toString('base64url') });
  await audit(req.user, 'room.create', 'room', room._id, body);
  res.status(201).json({ room: roomView(room) });
});

roomsRouter.get('/rooms/:id', requireRoomView(), async (req, res) => {
  const room = isObjectId(req.params.id) && (await Room.findById(req.params.id));
  if (!room) throw notFound('Room');
  res.json({ room: roomView(room) });
});

const POLICY_FIELDS = ['occupancySource', 'coverageValidated', 'controlMode', 'autoControlEnabled', 'qrExpiryPolicy'];

roomsRouter.patch('/rooms/:id', requireRole('admin'), async (req, res) => {
  const body = validate(roomBody.partial(), req.body);
  assertControlAllowed(body);
  const room = isObjectId(req.params.id) && (await Room.findById(req.params.id));
  if (!room) throw notFound('Room');
  const policyChanged = POLICY_FIELDS.some((f) => body[f] !== undefined && body[f] !== room[f]);
  Object.assign(room, body);
  // A policy change invalidates work queued under the old version.
  if (policyChanged) room.policyVersion += 1;
  await room.save();
  await audit(req.user, 'room.update', 'room', room._id, body);
  await emitLive('room.updated', { roomId: room._id });
  res.json({ room: roomView(room) });
});

roomsRouter.get('/rooms/:id/status', requireRoomView(), async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Room');
  res.json(await roomStatus(req.params.id));
});

roomsRouter.get('/rooms/:id/qr', requireRole('admin'), async (req, res) => {
  const room = isObjectId(req.params.id) && (await Room.findById(req.params.id));
  if (!room) throw notFound('Room');
  if (!room.qrPublicToken) {
    room.qrPublicToken = randomBytes(18).toString('base64url');
    await room.save();
  }
  // The QR carries only an opaque access URL: no device address, password or control action.
  const url = `${config().publicAppUrl}/access/${room.qrPublicToken}`;
  res.json({ url, dataUrl: await QRCode.toDataURL(url, { margin: 1, width: 320 }) });
});

// ---- assignments ----
roomsRouter.get('/rooms/:id/assignments', requireRoomView(), async (req, res) => {
  const room = isObjectId(req.params.id) && (await Room.findById(req.params.id).lean());
  if (!room) throw notFound('Room');
  res.json({ assignments: roomView(room).assignments });
});

roomsRouter.patch('/rooms/:id/assignments', requireRole('admin'), async (req, res) => {
  const body = validate(z.object({ firstResponderId: nullableOid, backupResponderId: nullableOid, secondResponderId: nullableOid }), req.body);
  const room = isObjectId(req.params.id) && (await Room.findById(req.params.id));
  if (!room) throw notFound('Room');
  for (const [key, value] of Object.entries(body)) {
    if (value && !(await User.exists({ _id: value, active: true }))) throw badRequest('invalid_user', `${key} is not an active user`);
    room.assignments[key] = value || undefined;
  }
  await room.save();
  await audit(req.user, 'room.assignments', 'room', room._id, body);
  res.json({ assignments: roomView(room).assignments });
});

// ---- room master: exactly one per room ----
const breakerBody = z.object({
  code: z.string().trim().min(1).max(30),
  adapter: z.enum(['simulator', 'physical']).optional(),
  nativeDeviceId: z.string().max(100).optional(),
  feederCoverage: z.string().max(500).optional(),
  verifiedRatings: z.string().max(500).optional(),
  minCycleSeconds: z.number().min(0).max(3600).optional(),
  health: z.enum(['online', 'offline', 'unknown']).optional(),
  interlocks: z.object({ faultTripped: z.boolean(), maintenanceLock: z.boolean(), manualIsolation: z.boolean() }).partial().optional(),
  simulator: z.object({ feedback: z.boolean(), failTransport: z.boolean() }).partial().optional(),
});

function assertAdapterAllowed(body) {
  if (body.adapter === 'physical') {
    const c = config();
    if (c.demoMode || !c.allowPhysicalControl) throw conflict('physical_control_disabled', 'A physical adapter cannot be configured on this server');
    if (!adapterStatus().physical.available) throw conflict('adapter_unavailable', adapterStatus().physical.reason);
  }
}

roomsRouter.post('/rooms/:id/breaker', requireRole('admin'), async (req, res) => {
  const body = validate(breakerBody, req.body);
  assertAdapterAllowed(body);
  if (!isObjectId(req.params.id) || !(await Room.exists({ _id: req.params.id }))) throw notFound('Room');
  if (await RoomBreaker.exists({ roomId: req.params.id })) throw conflict('room_master_exists', 'This room already has a master breaker; a room has exactly one');
  if (await RoomBreaker.exists({ code: body.code.toUpperCase() })) throw conflict('breaker_in_use', 'This breaker is already mapped to another room');
  const breaker = await RoomBreaker.create({ ...body, roomId: req.params.id });
  await Device.updateMany({ roomId: req.params.id }, { $set: { controlledByRoomBreakerId: breaker._id } });
  await audit(req.user, 'breaker.create', 'room', req.params.id, body);
  res.status(201).json({ breaker: breakerView(breaker) });
});

roomsRouter.patch('/rooms/:id/breaker', requireRole('admin'), async (req, res) => {
  const body = validate(breakerBody.partial(), req.body);
  assertAdapterAllowed(body);
  const breaker = isObjectId(req.params.id) && (await RoomBreaker.findOne({ roomId: req.params.id }));
  if (!breaker) throw notFound('Room master');
  const { interlocks, simulator, ...rest } = body;
  Object.assign(breaker, rest);
  if (interlocks) Object.assign(breaker.interlocks, interlocks);
  if (simulator) Object.assign(breaker.simulator, simulator);
  await breaker.save();
  await audit(req.user, 'breaker.update', 'room', req.params.id, body);
  await emitLive('room.updated', { roomId: req.params.id });
  res.json({ breaker: breakerView(breaker) });
});

// ---- load inventory: no switching here ----
const deviceBody = z.object({
  roomId: oid,
  name: z.string().trim().min(1).max(100),
  category: z.enum(['light', 'fan', 'ac', 'socket', 'projector', 'computer', 'other']),
  ratedWatts: z.number().min(0).max(100000),
  quantity: z.number().int().min(1).max(500).optional(),
  essential: z.boolean().optional(),
  supplyInterruptionApproved: z.boolean().optional(),
  requiresNormalStopBeforeCutoff: z.boolean().optional(),
  restartDelaySeconds: z.number().min(0).max(3600).optional(),
  restartBehaviourKnown: z.boolean().optional(),
  essentialStandbyRequirement: z.boolean().optional(),
  approvalNotes: z.string().max(500).optional(),
});

const deviceView = (d) => ({ ...(d.toObject?.() ?? d), id: String(d._id), _id: undefined, __v: undefined, roomId: String(d.roomId) });

roomsRouter.get('/devices', requireAuth, async (req, res) => {
  const q = {};
  if (req.query.roomId) {
    if (!isObjectId(req.query.roomId)) throw badRequest('invalid_room', 'roomId is invalid');
    q.roomId = req.query.roomId;
  }
  const devices = (await Device.find(q).sort({ roomId: 1, name: 1 }).lean()).filter((d) => canViewRoom(req.user, d.roomId));
  res.json({ devices: devices.map(deviceView), note: 'Inventory is for observation, estimates and shared-cutoff eligibility. Appliances are not individually switchable.' });
});

roomsRouter.post('/devices', requireRole('admin'), async (req, res) => {
  const body = validate(deviceBody, req.body);
  if (!(await Room.exists({ _id: body.roomId }))) throw notFound('Room');
  const breaker = await RoomBreaker.findOne({ roomId: body.roomId }).lean();
  const device = await Device.create({ ...body, controlledByRoomBreakerId: breaker?._id });
  await audit(req.user, 'device.create', 'device', device._id, body);
  res.status(201).json({ device: deviceView(device) });
});

roomsRouter.patch('/devices/:id', requireRole('admin'), async (req, res) => {
  const body = validate(deviceBody.omit({ roomId: true }).partial(), req.body);
  const device = isObjectId(req.params.id) && (await Device.findById(req.params.id));
  if (!device) throw notFound('Device');
  Object.assign(device, body);
  await device.save();
  await audit(req.user, 'device.update', 'device', device._id, body);
  await emitLive('room.updated', { roomId: device.roomId });
  res.json({ device: deviceView(device) });
});

// Staff confirm that a load needing a normal stop (typically an AC) was stopped with its own controls.
roomsRouter.post('/devices/:id/confirm-stop', requireRole('admin', 'hod', 'first_responder', 'teacher'), async (req, res) => {
  const device = isObjectId(req.params.id) && (await Device.findById(req.params.id));
  if (!device) throw notFound('Device');
  if (!canUseRoom(req.user, device.roomId) && req.user.role !== 'hod') throw forbidden();
  if (!device.requiresNormalStopBeforeCutoff) throw badRequest('not_required', 'This load does not require a stop procedure');
  device.stopProcedureConfirmedAt = now();
  device.stopProcedureConfirmedBy = req.user._id;
  await device.save();
  await audit(req.user, 'device.confirm_stop', 'device', device._id);
  await emitLive('room.updated', { roomId: device.roomId });
  res.json({ device: deviceView(device) });
});

// ---- schedules ----
const scheduleView = (s) => ({ id: String(s._id), roomId: String(s.roomId), startAt: s.startAt, endAt: s.endAt, title: s.title, status: s.status, origin: s.origin });
const isoDate = z.string().transform((v, ctx) => {
  const d = parseIsoDate(v);
  if (!d) {
    ctx.addIssue({ code: 'custom', message: 'must be an ISO 8601 timestamp with a UTC offset' });
    return z.NEVER;
  }
  return d;
});

roomsRouter.get('/schedules', requireAuth, async (req, res) => {
  const q = {};
  if (req.query.roomId && isObjectId(req.query.roomId)) q.roomId = req.query.roomId;
  const from = parseIsoDate(req.query.from) ?? new Date(now().getTime() - 86_400_000);
  const to = parseIsoDate(req.query.to) ?? new Date(now().getTime() + 7 * 86_400_000);
  q.endAt = { $gt: from };
  q.startAt = { $lt: to };
  const schedules = (await Schedule.find(q).sort({ startAt: 1 }).limit(2000).lean()).filter((s) => canViewRoom(req.user, s.roomId));
  res.json({ schedules: schedules.map(scheduleView) });
});

roomsRouter.post('/schedules', requireRole('admin', 'hod'), async (req, res) => {
  const body = validate(z.object({ roomId: oid, startAt: isoDate, endAt: isoDate, title: z.string().trim().min(1).max(200) }), req.body);
  if (body.endAt <= body.startAt) throw badRequest('invalid_range', 'endAt must be after startAt');
  if (!(await Room.exists({ _id: body.roomId }))) throw notFound('Room');
  const schedule = await Schedule.create({ ...body, origin: 'manual' });
  await audit(req.user, 'schedule.create', 'schedule', schedule._id, body);
  await emitLive('room.updated', { roomId: body.roomId });
  res.status(201).json({ schedule: scheduleView(schedule) });
});

roomsRouter.patch('/schedules/:id', requireRole('admin', 'hod'), async (req, res) => {
  const body = validate(z.object({ startAt: isoDate, endAt: isoDate, title: z.string().trim().min(1).max(200), status: z.enum(['confirmed', 'cancelled']), cancelReason: z.string().max(300) }).partial(), req.body);
  const schedule = isObjectId(req.params.id) && (await Schedule.findById(req.params.id));
  if (!schedule) throw notFound('Schedule');
  Object.assign(schedule, body);
  if (schedule.endAt <= schedule.startAt) throw badRequest('invalid_range', 'endAt must be after startAt');
  if (body.status === 'cancelled') schedule.cancelledAt = now();
  await schedule.save();
  await audit(req.user, 'schedule.update', 'schedule', schedule._id, body);
  await emitLive('room.updated', { roomId: schedule.roomId });
  res.json({ schedule: scheduleView(schedule) });
});

roomsRouter.post('/imports/timetable', requireRole('admin'), async (req, res) => {
  const { csv, commit } = validate(z.object({ csv: z.string().max(2_000_000), commit: z.boolean().default(false) }), req.body);
  const records = parseCsv(csv);
  const rooms = new Map((await Room.find().lean()).map((r) => [r.code, r]));
  const result = { accepted: [], duplicates: [], invalid: [] };
  const docs = [];
  const seen = new Set();
  for (const [i, r] of records.entries()) {
    const line = i + 2;
    const room = rooms.get(String(r.roomCode ?? '').toUpperCase());
    const startAt = parseIsoDate(r.startAt);
    const endAt = parseIsoDate(r.endAt);
    const status = r.status || 'confirmed';
    if (!room) result.invalid.push({ line, reason: `Unknown roomCode "${r.roomCode}"` });
    else if (!startAt || !endAt) result.invalid.push({ line, reason: 'startAt and endAt must be ISO 8601 timestamps with a UTC offset' });
    else if (endAt <= startAt) result.invalid.push({ line, reason: 'endAt must be after startAt' });
    else if (!r.title) result.invalid.push({ line, reason: 'title is missing' });
    else if (!['confirmed', 'cancelled'].includes(status)) result.invalid.push({ line, reason: `Unknown status "${status}"` });
    else {
      const importKey = `${room.code}|${startAt.toISOString()}|${endAt.toISOString()}|${r.title}`;
      const existing = seen.has(importKey) || (await Schedule.findOne({ importKey }).lean());
      seen.add(importKey);
      if (existing && (existing === true || existing.status === status)) result.duplicates.push({ line, roomCode: room.code, startAt, title: r.title });
      else {
        result.accepted.push({ line, roomCode: room.code, startAt, endAt, title: r.title, status });
        docs.push({ updateOne: { filter: { importKey }, update: { $set: { roomId: room._id, startAt, endAt, title: r.title, status, origin: 'import', cancelledAt: status === 'cancelled' ? now() : null } }, upsert: true } });
      }
    }
  }
  const summary = { accepted: result.accepted.length, duplicates: result.duplicates.length, invalid: result.invalid.length, committed: false, timezoneAssumption: 'Each timestamp must carry its own UTC offset; none is assumed' };
  if (commit && docs.length) {
    await Schedule.bulkWrite(docs);
    await audit(req.user, 'import.timetable', 'schedule', null, summary);
    await emitLive('schedules.updated');
  }
  summary.committed = commit;
  res.json({ summary, ...result });
});

// ---- QR access ----
roomsRouter.get('/access/:publicToken', async (req, res) => {
  const room = await Room.findOne({ qrPublicToken: req.params.publicToken });
  if (!room) throw notFound('Access link');
  const settings = await getSettings();
  const breaker = await RoomBreaker.findOne({ roomId: room._id }).lean();
  const out = {
    // Deliberately minimal: no staff details, device addresses or credentials.
    room: { id: String(room._id), code: room.code, name: room.name },
    policy: {
      maxDurationMinutes: settings.policies.qrMaxDurationMinutes,
      warningMinutes: settings.policies.qrExpiryWarningMinutes,
      accessHours: `${settings.policies.accessStartHour}:00–${settings.policies.accessEndHour}:00`,
      text: 'Access is a time-limited request for room supply. It ends at the stated time unless extended. Signing in does not prove you are in the room.',
    },
    supply: {
      available: Boolean(breaker) && room.controlMode !== 'alert_only',
      simulationOnly: !breaker || breaker.adapter === 'simulator',
      note: !breaker ? 'No room master is connected to this room' : room.controlMode === 'alert_only' ? 'This room is alert-only: the application will not switch its supply' : null,
    },
    timeScale: config().demoTimeScale,
  };
  if (req.user) {
    const lease = await AccessLease.findOne({ roomId: room._id, status: 'active', expiresAt: { $gt: now() } }).lean();
    out.viewer = { canRequest: ['admin', 'hod', 'first_responder', 'teacher'].includes(req.user.role) && canUseRoom(req.user, room._id) };
    out.lease = lease && (String(lease.requesterId) === String(req.user._id) || canViewRoom(req.user, room._id)) ? leaseView(lease) : lease ? { active: true } : null;
    out.supply.state = out.viewer.canRequest ? (breaker?.supplyState ?? null) : undefined;
  }
  res.json(out);
});

roomsRouter.post('/rooms/:id/access-leases', leaseLimiter, requireAuth, async (req, res) => {
  const body = validate(z.object({ durationMinutes: z.number().positive(), acceptPolicy: z.boolean() }), req.body);
  if (!isObjectId(req.params.id)) throw notFound('Room');
  const { lease, command } = await createLease(req.params.id, req.user, body);
  res.status(201).json({ lease: leaseView(lease), command: command && commandResultView(command) });
});

roomsRouter.post('/access-leases/:id/extend', leaseLimiter, requireAuth, async (req, res) => {
  const body = validate(z.object({ additionalMinutes: z.number().positive() }), req.body);
  if (!isObjectId(req.params.id)) throw notFound('Access lease');
  res.json({ lease: leaseView(await extendLease(req.params.id, req.user, body)) });
});

roomsRouter.post('/access-leases/:id/end', requireAuth, async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Access lease');
  res.json({ lease: leaseView(await endLease(req.params.id, req.user)) });
});

// ---- overrides ----
const overrideView = (o) => ({ id: String(o._id), roomId: String(o.roomId), reason: o.reason, startAt: o.startAt, endAt: o.endAt, cancelledAt: o.cancelledAt ?? null });

roomsRouter.post('/rooms/:id/overrides', requireAuth, async (req, res) => {
  const body = validate(z.object({ reason: z.string().trim().min(3).max(300), durationMinutes: z.number().positive() }), req.body);
  if (!isObjectId(req.params.id)) throw notFound('Room');
  res.status(201).json({ override: overrideView(await createOverride(req.params.id, req.user, body)) });
});

roomsRouter.post('/overrides/:id/end', requireAuth, async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Override');
  res.json({ override: overrideView(await endOverride(req.params.id, req.user)) });
});

// ---- room-level supply commands: the only control endpoint ----
roomsRouter.post('/rooms/:id/supply-commands', commandLimiter, requireRole('admin', 'hod', 'first_responder'), async (req, res) => {
  const body = validate(z.object({ action: z.enum(['on', 'off']), incidentId: oid.optional() }), req.body);
  if (!isObjectId(req.params.id)) throw notFound('Room');
  if (!canUseRoom(req.user, req.params.id) && req.user.role !== 'hod') throw forbidden('You are not authorised to control this room');
  const incident = body.incidentId ? await Incident.findOne({ _id: body.incidentId, roomId: req.params.id }) : null;
  const command = await issueSupplyCommand({ roomId: req.params.id, action: body.action, reason: 'manual', incident, actor: req.user });
  if (incident?.active && command.status === 'completed' && command.action === 'off') {
    incident.commandIds.push(command._id);
    if (command.reportedOutput === 'off') {
      await closeIncident(incident, 'resolved', `Supply switched OFF by ${req.user.name} (${command.verification})`, {
        actor: req.user,
        resolution: { method: 'manual_supply_off', by: req.user._id, verification: command.verification },
      });
    } else await incident.save();
  }
  res.status(command.status === 'completed' ? 201 : 409).json({ command: commandResultView(command) });
});

roomsRouter.get('/commands/:id', requireAuth, async (req, res) => {
  const command = await Command.findOne({ requestId: req.params.id });
  if (!command || !canViewRoom(req.user, command.roomId)) throw notFound('Command');
  res.json({ command: commandResultView(command) });
});

roomsRouter.get('/rooms/:id/commands', requireRoomView(), async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Room');
  const commands = await Command.find({ roomId: req.params.id }).sort({ issuedAt: -1 }).limit(30);
  res.json({ commands: commands.map(commandResultView) });
});

export { Override };
