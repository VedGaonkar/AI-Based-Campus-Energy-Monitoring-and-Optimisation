import { addPolicyMinutes, now, policyMs } from '../clock.js';
import { Incident, Job, Room, User } from '../models/index.js';
import { badRequest, conflict, emitLive, getSettings } from './core.js';
import { notify } from './notifications.js';

const OPEN_JOB = { status: { $in: ['pending', 'leased'] } };

export function timeline(incident, kind, text, { actor, data } = {}) {
  incident.timeline.push({ at: now(), kind, text, actorId: actor?._id, actorLabel: actor?.name ?? 'system', data });
}

export async function cancelJobs(filter, reason, exceptJobId) {
  const q = { ...filter, ...OPEN_JOB };
  if (exceptJobId) q._id = { $ne: exceptJobId };
  await Job.updateMany(q, { $set: { status: 'cancelled', result: reason, finishedAt: now() } });
}

export async function createJob(job) {
  try {
    return await Job.create(job);
  } catch (err) {
    if (err.code === 11000) return Job.findOne({ idempotencyKey: job.idempotencyKey });
    throw err;
  }
}

async function announce(incident) {
  await emitLive('incident.updated', { roomId: incident.roomId, payload: { id: String(incident._id), state: incident.state, type: incident.type } });
}

// Schedules the three escalation stages from stored due times. `round` keeps keys unique after a snooze.
export async function scheduleEscalation(incident, settings, { from = now(), round = 0, includeFirst = true, includeEscalate = true } = {}) {
  const p = settings.policies;
  const escalateAt = includeFirst ? addPolicyMinutes(from, p.firstEscalationMinutes) : from;
  const finalAt = addPolicyMinutes(escalateAt, p.finalEscalationAdditionalMinutes);
  const base = { incidentId: incident._id, roomId: incident.roomId, policyVersion: incident.policyVersion };
  if (includeFirst) await createJob({ ...base, type: 'notify_first', dueAt: from, idempotencyKey: `${incident._id}:notify_first:${round}` });
  if (includeEscalate) await createJob({ ...base, type: 'escalate', dueAt: escalateAt, idempotencyKey: `${incident._id}:escalate:${round}` });
  await createJob({ ...base, type: 'final_check', dueAt: finalAt, idempotencyKey: `${incident._id}:final_check:${round}` });
  incident.escalateDueAt = includeEscalate ? escalateAt : incident.escalateDueAt;
  incident.finalDueAt = finalAt;
}

export async function openVacancyIncident(room, breaker, occupancy) {
  const settings = await getSettings();
  const issueKey = `vacancy:${room._id}`;
  const episode = (await Incident.countDocuments({ issueKey })) + 1;
  const simulated = occupancy.dataMode !== 'live';
  let incident;
  try {
    incident = await Incident.create({
      type: 'vacancy_waste',
      scope: 'room',
      roomId: room._id,
      issueKey,
      episode,
      active: true,
      state: 'open',
      title: `${room.code}: supply ON in a vacant room with no scheduled use`,
      severity: 'medium',
      dataMode: occupancy.dataMode ?? 'live',
      policyVersion: room.policyVersion,
      assignments: { ...(room.assignments?.toObject?.() ?? room.assignments ?? {}) },
      openedAt: now(),
      evidence: [
        {
          label: simulated ? 'Simulated' : room.occupancySource === 'camera' ? 'Camera-observed' : 'Sensor-reported',
          source: room.occupancy?.sourceId,
          text: `No person detected since ${new Date(occupancy.vacantSince).toISOString()}; coverage validated`,
          at: room.occupancy?.lastObservationAt,
        },
        { label: breaker.adapter === 'simulator' ? 'Simulated' : 'Sensor-reported', source: breaker.code, text: 'Room master reports supply ON', at: now() },
        ...(room.occupancy?.equipmentOn === true
          ? [{ label: simulated ? 'Simulated' : 'Camera-observed', source: room.occupancy?.sourceId, text: 'Equipment appears ON in the observed region', at: room.occupancy?.lastObservationAt }]
          : []),
      ],
      timeline: [{ at: now(), kind: 'opened', text: 'Vacancy confirmed with no booking, access lease or override', actorLabel: 'system' }],
    });
  } catch (err) {
    if (err.code === 11000) return Incident.findOne({ issueKey, active: true });
    throw err;
  }
  await scheduleEscalation(incident, settings);
  await incident.save();
  await announce(incident);
  return incident;
}

export async function closeIncident(incident, state, text, { actor, resolution, exceptJobId } = {}) {
  incident.state = state;
  incident.active = false;
  incident.resolvedAt = now();
  if (resolution) incident.resolution = resolution;
  timeline(incident, state, text, { actor });
  await cancelJobs({ incidentId: incident._id }, `Incident ${state}`, exceptJobId);
  await incident.save();
  await announce(incident);
  return incident;
}

// Marks the incident as a manual task: no automatic action will follow.
export async function blockIncident(incident, reason, { exceptJobId } = {}) {
  if (incident.state === 'blocked' && incident.blockReason === reason) return incident;
  incident.state = 'blocked';
  incident.blockReason = reason;
  timeline(incident, 'blocked', `Automatic action blocked: ${reason}. Manual inspection is required.`);
  await cancelJobs({ incidentId: incident._id }, 'Incident blocked', exceptJobId);
  await incident.save();
  await announce(incident);
  return incident;
}

export async function cancelActiveVacancyIncident(roomId, reason, actor) {
  const incident = await Incident.findOne({ issueKey: `vacancy:${roomId}`, active: true });
  if (!incident) return null;
  return closeIncident(incident, 'cancelled', reason, { actor });
}

export function canAccessIncident(user, incident) {
  if (user.role === 'admin') return true;
  const uid = String(user._id);
  const a = incident.assignments ?? {};
  if ([a.firstResponderId, a.backupResponderId, a.secondResponderId].some((id) => id && String(id) === uid)) return true;
  if (incident.scope === 'building_meter') return user.role === 'hod';
  return (user.permittedRoomIds ?? []).some((id) => String(id) === String(incident.roomId)) && user.role !== 'viewer';
}

const ACK_STATES = ['open', 'notified_first', 'escalated', 'blocked', 'action_unverified', 'failed'];
const SNOOZE_STATES = ['open', 'notified_first', 'escalated', 'inspecting'];

// Acknowledging records that someone is looking. It never closes the incident.
export async function acknowledgeIncident(incident, user) {
  if (!incident.active) throw conflict('incident_closed', 'Incident is already closed');
  if (!ACK_STATES.includes(incident.state) && incident.state !== 'inspecting') throw conflict('invalid_state', `Cannot acknowledge an incident in state ${incident.state}`);
  incident.acknowledgedAt = now();
  incident.acknowledgedBy = user._id;
  if (['open', 'notified_first', 'escalated'].includes(incident.state)) incident.state = 'inspecting';
  timeline(incident, 'acknowledged', 'Acknowledged; inspection in progress. The incident remains open until resolved.', { actor: user });
  await incident.save();
  await announce(incident);
  return incident;
}

export async function snoozeIncident(incident, user, minutes) {
  const settings = await getSettings();
  if (!incident.active) throw conflict('incident_closed', 'Incident is already closed');
  if (incident.type !== 'vacancy_waste') throw badRequest('not_snoozable', 'Only room incidents can be snoozed');
  if (!SNOOZE_STATES.includes(incident.state)) throw conflict('invalid_state', `Cannot snooze an incident in state ${incident.state}`);
  if (!(minutes > 0) || minutes > settings.policies.snoozeMaxMinutes) {
    throw badRequest('invalid_duration', `Snooze must be between 1 and ${settings.policies.snoozeMaxMinutes} minutes`);
  }
  await cancelJobs({ incidentId: incident._id }, 'Snoozed');
  incident.state = 'snoozed';
  incident.snoozedUntil = new Date(now().getTime() + policyMs(minutes));
  timeline(incident, 'snoozed', `Snoozed for ${minutes} minutes`, { actor: user });
  await createJob({
    type: 'snooze_expiry',
    incidentId: incident._id,
    roomId: incident.roomId,
    policyVersion: incident.policyVersion,
    dueAt: incident.snoozedUntil,
    idempotencyKey: `${incident._id}:snooze_expiry:${incident.snoozedUntil.getTime()}`,
  });
  await incident.save();
  await announce(incident);
  return incident;
}

export async function resolveIncident(incident, user, { method, note, confirmedCause }) {
  if (!incident.active) throw conflict('incident_closed', 'Incident is already closed');
  if (confirmedCause) incident.confirmedCause = confirmedCause;
  if (incident.type === 'energy_anomaly' && incident.anomaly) incident.anomaly.inspectionStatus = 'inspected';
  return closeIncident(incident, 'resolved', `Resolved (${method})${note ? `: ${note}` : ''}`, {
    actor: user,
    resolution: { method, note, by: user._id, verification: 'manually_confirmed' },
  });
}

export async function reassignIncident(incident, user, assignments) {
  for (const key of ['firstResponderId', 'backupResponderId', 'secondResponderId']) {
    if (assignments[key] !== undefined) {
      if (assignments[key] && !(await User.exists({ _id: assignments[key], active: true }))) throw badRequest('invalid_user', `${key} is not an active user`);
      incident.assignments[key] = assignments[key] || undefined;
    }
  }
  timeline(incident, 'reassigned', 'Responders reassigned by an administrator', { actor: user });
  await incident.save();
  await announce(incident);
  return incident;
}

export function incidentMessage(incident, room, stage, settings) {
  const where = room ? `${room.code} (${room.name})` : 'Building meter';
  const evidence = incident.evidence.map((e) => `${e.label}: ${e.text}`).join('; ');
  const sim = incident.dataMode !== 'live' ? ' [Simulation]' : '';
  const deadline = incident.finalDueAt ? ` Final recheck at ${incident.finalDueAt.toISOString()}.` : '';
  const titles = {
    first: `Action needed: ${where}${sim}`,
    escalation: `Escalation: ${where} is still unresolved${sim}`,
    manual_task: `Manual action required: ${where}${sim}`,
    unverified: `Unverified switch-off: ${where}${sim}`,
    anomaly: `Energy anomaly on ${settings?.meterId ?? 'building meter'}${sim}`,
  };
  return {
    title: titles[stage] ?? `${where}${sim}`,
    body: `${incident.title}. Evidence: ${evidence || 'see incident'}. Requested action: inspect and record the outcome.${deadline}`,
    link: `/incidents/${incident._id}`,
    dataMode: incident.dataMode,
  };
}

export async function notifyAnomalyResponders(incident, settings) {
  const ids = settings.energyResponderIds?.length
    ? settings.energyResponderIds
    : (await User.find({ role: 'admin', active: true }).select('_id').lean()).map((u) => u._id);
  const msg = incidentMessage(incident, null, 'anomaly', settings);
  for (const id of ids) await notify({ ...msg, incidentId: incident._id, stage: 'anomaly', recipientId: id });
}

export async function loadRoom(roomId) {
  return roomId ? Room.findById(roomId) : null;
}
