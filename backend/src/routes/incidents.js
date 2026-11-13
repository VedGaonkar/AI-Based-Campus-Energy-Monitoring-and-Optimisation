import { Router } from 'express';
import { z } from 'zod';
import { now } from '../clock.js';
import { Command, Incident, Job, Notification, Room, User } from '../models/index.js';
import { isObjectId, requireAuth, requireRole, validate } from '../security/auth.js';
import { commandResultView } from '../services/commands.js';
import { audit, forbidden, notFound } from '../services/core.js';
import { acknowledgeIncident, canAccessIncident, reassignIncident, resolveIncident, snoozeIncident } from '../services/incidents.js';

export const incidentsRouter = Router();
const oid = z.string().refine(isObjectId, 'must be a valid id');

function listView(i, rooms) {
  const room = i.roomId ? rooms.get(String(i.roomId)) : null;
  return {
    id: String(i._id),
    type: i.type,
    scope: i.scope,
    roomId: i.roomId ? String(i.roomId) : null,
    roomCode: room?.code ?? null,
    meterId: i.meterId ?? null,
    title: i.title,
    state: i.state,
    active: i.active,
    severity: i.severity,
    dataMode: i.dataMode,
    episode: i.episode,
    openedAt: i.openedAt,
    escalateDueAt: i.escalateDueAt ?? null,
    finalDueAt: i.finalDueAt ?? null,
    snoozedUntil: i.snoozedUntil ?? null,
    acknowledgedAt: i.acknowledgedAt ?? null,
    resolvedAt: i.resolvedAt ?? null,
    blockReason: i.blockReason ?? null,
    assignments: Object.fromEntries(Object.entries(i.assignments?.toObject?.() ?? i.assignments ?? {}).map(([k, v]) => [k, v ? String(v) : null])),
  };
}

async function loadIncident(req) {
  const incident = isObjectId(req.params.id) && (await Incident.findById(req.params.id));
  if (!incident) throw notFound('Incident');
  if (!canAccessIncident(req.user, incident)) throw forbidden('This incident is not assigned to you');
  return incident;
}

incidentsRouter.get('/incidents', requireAuth, async (req, res) => {
  const q = {};
  if (req.query.active === 'true') q.active = true;
  if (req.query.active === 'false') q.active = false;
  if (req.query.type) q.type = String(req.query.type);
  if (req.query.state) q.state = String(req.query.state);
  if (req.query.roomId && isObjectId(req.query.roomId)) q.roomId = req.query.roomId;
  const incidents = (await Incident.find(q).sort({ active: -1, openedAt: -1 }).limit(300).lean()).filter((i) => canAccessIncident(req.user, i));
  const mine = req.query.assigned === 'me' ? incidents.filter((i) => Object.values(i.assignments ?? {}).some((v) => v && String(v) === String(req.user._id))) : incidents;
  const rooms = new Map((await Room.find().select('code name').lean()).map((r) => [String(r._id), r]));
  res.json({ incidents: mine.map((i) => listView(i, rooms)), serverTime: now() });
});

incidentsRouter.get('/incidents/:id', requireAuth, async (req, res) => {
  const incident = await loadIncident(req);
  const rooms = new Map((await Room.find().select('code name').lean()).map((r) => [String(r._id), r]));
  const [commands, jobs, notifications, users] = await Promise.all([
    Command.find({ incidentId: incident._id }).sort({ issuedAt: 1 }),
    Job.find({ incidentId: incident._id }).sort({ dueAt: 1 }).lean(),
    Notification.find({ incidentId: incident._id }).sort({ createdAt: 1 }).lean(),
    User.find().select('name role').lean(),
  ]);
  const names = new Map(users.map((u) => [String(u._id), u.name]));
  res.json({
    incident: {
      ...listView(incident, rooms),
      evidence: incident.evidence,
      timeline: incident.timeline,
      resolution: incident.resolution?.method ? incident.resolution : null,
      suspectedCause: incident.suspectedCause ?? null,
      confirmedCause: incident.confirmedCause ?? null,
      anomaly: incident.type === 'energy_anomaly' ? incident.anomaly : null,
      assignmentNames: Object.fromEntries(Object.entries(incident.assignments?.toObject?.() ?? {}).map(([k, v]) => [k, v ? (names.get(String(v)) ?? null) : null])),
    },
    commands: commands.map(commandResultView),
    // Countdown data comes from stored due times, never from a browser timer.
    jobs: jobs.map((j) => ({ type: j.type, dueAt: j.dueAt, status: j.status, result: j.result ?? null })),
    notifications: notifications.map((n) => ({ stage: n.stage, recipient: n.recipientId ? (names.get(String(n.recipientId)) ?? null) : null, deliveryState: n.deliveryState, failureReason: n.failureReason ?? null, readAt: n.readAt ?? null, createdAt: n.createdAt })),
    serverTime: now(),
  });
});

incidentsRouter.post('/incidents/:id/acknowledge', requireRole('admin', 'hod', 'first_responder'), async (req, res) => {
  const incident = await acknowledgeIncident(await loadIncident(req), req.user);
  await audit(req.user, 'incident.acknowledge', 'incident', incident._id);
  res.json({ id: String(incident._id), state: incident.state, active: incident.active });
});

incidentsRouter.post('/incidents/:id/snooze', requireRole('admin', 'hod', 'first_responder'), async (req, res) => {
  const { minutes } = validate(z.object({ minutes: z.number().positive() }), req.body);
  const incident = await snoozeIncident(await loadIncident(req), req.user, minutes);
  await audit(req.user, 'incident.snooze', 'incident', incident._id, { minutes });
  res.json({ id: String(incident._id), state: incident.state, snoozedUntil: incident.snoozedUntil });
});

incidentsRouter.post('/incidents/:id/resolve', requireRole('admin', 'hod', 'first_responder'), async (req, res) => {
  const body = validate(
    z.object({
      method: z.enum(['manual_switch_off', 'authorised_use', 'false_alarm', 'inspected_no_cause', 'cause_confirmed', 'other']),
      note: z.string().trim().max(1000).optional(),
      confirmedCause: z.string().trim().max(500).optional(),
    }),
    req.body,
  );
  const incident = await resolveIncident(await loadIncident(req), req.user, body);
  await audit(req.user, 'incident.resolve', 'incident', incident._id, body);
  res.json({ id: String(incident._id), state: incident.state, active: incident.active });
});

incidentsRouter.post('/incidents/:id/reassign', requireRole('admin'), async (req, res) => {
  const body = validate(z.object({ firstResponderId: oid.nullable().optional(), backupResponderId: oid.nullable().optional(), secondResponderId: oid.nullable().optional() }), req.body);
  const incident = await reassignIncident(await loadIncident(req), req.user, body);
  await audit(req.user, 'incident.reassign', 'incident', incident._id, body);
  res.json({ id: String(incident._id), assignments: incident.assignments });
});

// ---- in-app inbox ----
incidentsRouter.get('/notifications', requireAuth, async (req, res) => {
  const items = await Notification.find({ recipientId: req.user._id, deliveryState: 'delivered' }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({
    unread: items.filter((n) => !n.readAt).length,
    notifications: items.map((n) => ({ id: String(n._id), title: n.title, body: n.body, link: n.link ?? null, stage: n.stage, dataMode: n.dataMode, readAt: n.readAt ?? null, createdAt: n.createdAt })),
  });
});

incidentsRouter.post('/notifications/:id/read', requireAuth, async (req, res) => {
  if (!isObjectId(req.params.id)) throw notFound('Notification');
  // "Read" only means the message was opened. It is not evidence that anything was switched off.
  await Notification.updateOne({ _id: req.params.id, recipientId: req.user._id, readAt: null }, { $set: { readAt: now() } });
  res.json({ ok: true });
});

incidentsRouter.post('/notifications/read-all', requireAuth, async (req, res) => {
  await Notification.updateMany({ recipientId: req.user._id, readAt: null }, { $set: { readAt: now() } });
  res.json({ ok: true });
});
