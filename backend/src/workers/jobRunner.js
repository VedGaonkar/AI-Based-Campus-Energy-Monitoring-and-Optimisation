import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { now } from '../clock.js';
import { AccessLease, Command, Incident, Job, Room, RoomBreaker, User } from '../models/index.js';
import { vacancyStopReason } from '../policies/index.js';
import { commandConfirmedOff, issueSupplyCommand } from '../services/commands.js';
import { emitLive, getSettings } from '../services/core.js';
import {
  blockIncident,
  cancelJobs,
  closeIncident,
  incidentMessage,
  openVacancyIncident,
  scheduleEscalation,
  timeline,
} from '../services/incidents.js';
import { notify, notifyFirstAvailable } from '../services/notifications.js';
import { getRoomContext } from '../services/roomState.js';

const JOB_LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const AUTOMATION = { label: 'automation' };

// Atomically claims one due job. A lease that expired (crashed worker) is claimable again,
// which is how overdue work is recovered after a restart.
export async function claimDueJob(owner, at = now()) {
  return Job.findOneAndUpdate(
    { dueAt: { $lte: at }, $or: [{ status: 'pending' }, { status: 'leased', leaseUntil: { $lt: at } }] },
    { $set: { status: 'leased', leaseOwner: owner, leaseUntil: new Date(at.getTime() + JOB_LEASE_MS) }, $inc: { attempts: 1 } },
    { sort: { dueAt: 1 }, returnDocument: 'after' },
  );
}

async function notifyManualTask(incident, room, settings, stage = 'manual_task') {
  const msg = incidentMessage(incident, room, stage, settings);
  const a = incident.assignments ?? {};
  for (const id of new Set([a.firstResponderId, a.secondResponderId].filter(Boolean).map(String))) {
    await notify({ ...msg, incidentId: incident._id, stage, recipientId: id });
  }
}

// Applies a stop condition. Returns true when the incident may not proceed.
async function applyStop(incident, ctx, { exceptJobId } = {}) {
  const stop = vacancyStopReason(ctx);
  if (!stop) return false;
  if (stop.kind === 'resolve') {
    await closeIncident(incident, 'resolved', stop.reason, {
      exceptJobId,
      resolution: { method: 'supply_already_off', note: stop.reason, verification: ctx.breaker.lastVerification },
    });
  } else if (stop.kind === 'cancel') {
    await closeIncident(incident, 'cancelled', stop.reason, { exceptJobId });
  } else if (incident.state !== 'snoozed') {
    const already = incident.state === 'blocked';
    await blockIncident(incident, stop.reason, { exceptJobId });
    if (!already) await notifyManualTask(incident, ctx.room, ctx.settings);
  }
  return true;
}

async function applyCommandOutcome(incident, command, ctx, exceptJobId) {
  if (command.status === 'rejected') {
    await blockIncident(incident, command.rejectReasons.join('; '), { exceptJobId });
    await notifyManualTask(incident, ctx.room, ctx.settings);
    return 'blocked';
  }
  if (commandConfirmedOff(command)) {
    const simulated = command.verification === 'simulated';
    await closeIncident(
      incident,
      'resolved',
      `Room master ${command.roomBreakerCode} reported supply OFF (${command.verification})${simulated ? '. Simulated: no physical supply was switched.' : ''}`,
      { exceptJobId, resolution: { method: 'automatic_supply_off', verification: command.verification } },
    );
    return 'resolved';
  }
  if (command.status === 'completed') {
    // Sent, but nothing confirms the result: never report this as a shutdown.
    incident.state = 'action_unverified';
    timeline(incident, 'action_unverified', `OFF command was transmitted to ${command.roomBreakerCode} without confirmation (${command.verification}). Confirm on site.`);
    await cancelJobs({ incidentId: incident._id }, 'Awaiting manual confirmation', exceptJobId);
    await incident.save();
    await notifyManualTask(incident, ctx.room, ctx.settings, 'unverified');
    await emitLive('incident.updated', { roomId: incident.roomId, payload: { id: String(incident._id), state: incident.state } });
    return 'action_unverified';
  }
  incident.state = 'failed';
  timeline(incident, 'failed', `OFF command ${command.status}; the room supply was not switched. Manual review is required.`);
  await cancelJobs({ incidentId: incident._id }, 'Command failed', exceptJobId);
  await incident.save();
  await notifyManualTask(incident, ctx.room, ctx.settings);
  await emitLive('incident.updated', { roomId: incident.roomId, payload: { id: String(incident._id), state: incident.state } });
  return 'failed';
}

async function finalCheck(incident, ctx, job) {
  // A restart must not blindly repeat a command that was already issued for this incident.
  if (incident.commandIds.length) {
    const prior = await Command.findById(incident.commandIds.at(-1));
    if (prior && prior.status !== 'pending') return applyCommandOutcome(incident, prior, ctx, job._id);
    incident.state = 'action_unverified';
    timeline(incident, 'action_unverified', 'A command was in progress when the worker stopped; its result is unknown. Confirm on site.');
    await cancelJobs({ incidentId: incident._id }, 'Awaiting manual confirmation', job._id);
    await incident.save();
    await notifyManualTask(incident, ctx.room, ctx.settings, 'unverified');
    return 'action_unverified';
  }
  if (ctx.room.controlMode === 'alert_only' || !ctx.room.autoControlEnabled) {
    await blockIncident(incident, 'Room is alert-only: switch off manually and record the outcome', { exceptJobId: job._id });
    await notifyManualTask(incident, ctx.room, ctx.settings);
    return 'manual_task';
  }
  incident.state = 'shutdown_pending';
  timeline(incident, 'shutdown_pending', 'Final recheck passed; preparing room-level OFF command');
  await incident.save();

  const command = await issueSupplyCommand({ roomId: ctx.room._id, action: 'off', reason: 'vacancy_escalation', incident, actor: AUTOMATION });
  incident.commandIds.push(command._id);
  incident.state = 'action_sent';
  timeline(incident, 'action_sent', `OFF command ${command.requestId} issued to ${command.roomBreakerCode}`, { data: { requestId: command.requestId } });
  await incident.save();
  return applyCommandOutcome(incident, command, ctx, job._id);
}

async function handleIncidentJob(job) {
  const incident = await Incident.findById(job.incidentId);
  if (!incident || !incident.active) return 'incident closed';
  const ctx = await getRoomContext(incident.roomId, now());
  if (!ctx) return 'room missing';
  const { room, settings } = ctx;

  if (job.policyVersion !== room.policyVersion) {
    await closeIncident(incident, 'cancelled', 'Room policy changed; pending work was invalidated', { exceptJobId: job._id });
    return 'stale policy';
  }
  if (incident.state === 'snoozed' && job.type !== 'snooze_expiry') return 'snoozed';
  // Every stage starts from current evidence, never from what was true when the job was queued.
  if (await applyStop(incident, ctx, { exceptJobId: job._id })) return `stopped: ${incident.state}`;

  const a = incident.assignments ?? {};
  if (job.type === 'notify_first') {
    const msg = incidentMessage(incident, room, 'first', settings);
    const r = await notifyFirstAvailable([a.firstResponderId, a.backupResponderId], { ...msg, incidentId: incident._id, stage: 'first' });
    incident.firstNotifiedAt = now();
    if (incident.state === 'open') incident.state = 'notified_first';
    for (const attempt of r.attempts.filter((x) => !x.delivered)) {
      timeline(incident, 'notification_failed', `First notification failed (${attempt.reason}); routed to the backup responder`);
    }
    timeline(incident, 'notified_first', r.delivered ? 'First responder notified in-app' : 'First notification could not be delivered to any responder; escalation continues', {
      data: { recipientId: r.recipientId ? String(r.recipientId) : null },
    });
    await incident.save();
  } else if (job.type === 'escalate') {
    const msg = incidentMessage(incident, room, 'escalation', settings);
    const r = await notifyFirstAvailable([a.secondResponderId, a.backupResponderId], { ...msg, incidentId: incident._id, stage: 'escalation' });
    incident.escalatedAt = now();
    incident.state = 'escalated';
    timeline(incident, 'escalated', r.delivered ? 'Unresolved after the first stage; HOD / second responder notified' : 'Escalation could not be delivered to any responder', {
      data: { recipientId: r.recipientId ? String(r.recipientId) : null },
    });
    await incident.save();
  } else if (job.type === 'snooze_expiry') {
    incident.state = incident.escalatedAt ? 'escalated' : 'notified_first';
    incident.snoozedUntil = undefined;
    timeline(incident, 'snooze_expired', 'Snooze expired; current evidence still shows an eligible issue, escalation resumes');
    await scheduleEscalation(incident, settings, { round: now().getTime(), includeFirst: false, includeEscalate: !incident.escalatedAt });
    await incident.save();
  } else if (job.type === 'final_check') {
    return finalCheck(incident, ctx, job);
  }
  await emitLive('incident.updated', { roomId: incident.roomId, payload: { id: String(incident._id), state: incident.state } });
  return incident.state;
}

async function handleLeaseJob(job) {
  const lease = await AccessLease.findById(job.leaseId);
  if (!lease || lease.status !== 'active') return 'lease not active';
  const settings = await getSettings();
  const room = await Room.findById(lease.roomId);

  if (job.type === 'lease_warning') {
    if (lease.warningSentAt) return 'already warned';
    await notify({
      leaseId: lease._id,
      stage: `lease_warning:${lease.expiresAt.getTime()}`,
      recipientId: lease.requesterId,
      title: `${room.code}: access ends soon`,
      body: `Your access to ${room.code} ends at ${lease.expiresAt.toISOString()}. Extend it if the room is still in use.`,
      link: `/access/${room.qrPublicToken}`,
      dataMode: lease.dataMode,
    });
    lease.warningSentAt = now();
    await lease.save();
    return 'warned';
  }

  if (now() < lease.expiresAt) return 'not yet due';
  lease.status = 'expired';
  lease.endedAt = now();
  lease.endReason = 'Expired';
  await lease.save();
  await emitLive('room.updated', { roomId: room._id });

  // Expiry removes authorised-use protection. It says nothing about whether the room is empty.
  if (room.occupancySource !== 'none') return 'expired; occupancy source decides';
  const breaker = await RoomBreaker.findOne({ roomId: room._id }).lean();
  if (!breaker || breaker.supplyState === 'off') return 'expired; supply already off';

  if (room.qrExpiryPolicy === 'fixed_duration_cutoff') {
    const command = await issueSupplyCommand({ roomId: room._id, action: 'off', reason: 'fixed_duration_expiry', leaseId: lease._id, actor: AUTOMATION });
    if (command.status === 'completed') return `fixed-duration cutoff ${command.verification}`;
  }
  const issueKey = `lease_expiry:${room._id}`;
  let incident = await Incident.findOne({ issueKey, active: true });
  if (!incident) {
    try {
      incident = await Incident.create({
        type: 'lease_expiry',
        scope: 'room',
        roomId: room._id,
        issueKey,
        episode: (await Incident.countDocuments({ issueKey })) + 1,
        state: 'open',
        title: `${room.code}: access lease expired and occupancy is unknown`,
        severity: 'low',
        dataMode: lease.dataMode,
        policyVersion: room.policyVersion,
        assignments: { ...(room.assignments?.toObject?.() ?? {}) },
        openedAt: now(),
        evidence: [{ label: 'Unknown', text: 'This room has no camera or presence sensor; lease expiry is not evidence that it is empty', at: now() }],
        timeline: [{ at: now(), kind: 'opened', text: 'Access lease expired; staff confirmation requested', actorLabel: 'system' }],
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
      incident = await Incident.findOne({ issueKey, active: true });
    }
  }
  await notifyManualTask(incident, room, settings);
  incident.state = 'notified_first';
  incident.firstNotifiedAt = now();
  await incident.save();
  await emitLive('incident.updated', { roomId: room._id, payload: { id: String(incident._id), state: incident.state } });
  return 'expired; staff confirmation requested';
}

export async function runJob(job) {
  if (job.type.startsWith('lease_')) return handleLeaseJob(job);
  return handleIncidentJob(job);
}

export async function runDueJobs({ owner = 'worker', limit = 100 } = {}) {
  const results = [];
  for (let i = 0; i < limit; i += 1) {
    const job = await claimDueJob(owner);
    if (!job) break;
    try {
      const result = await runJob(job);
      await Job.updateOne({ _id: job._id, status: 'leased', leaseOwner: owner }, { $set: { status: 'done', result: String(result), finishedAt: now() }, $unset: { leaseOwner: 1, leaseUntil: 1 } });
      results.push({ id: String(job._id), type: job.type, result });
    } catch (err) {
      const terminal = job.attempts >= MAX_ATTEMPTS;
      await Job.updateOne(
        { _id: job._id },
        { $set: { status: terminal ? 'failed' : 'pending', result: `error: ${err.message}`, dueAt: terminal ? job.dueAt : new Date(now().getTime() + 5000) }, $unset: { leaseOwner: 1, leaseUntil: 1 } },
      );
      results.push({ id: String(job._id), type: job.type, error: err.message });
      if (config().env !== 'test') console.error(`[worker] job ${job.type} ${job._id} failed:`, err);
    }
  }
  return results;
}

// Looks at every controlled room: opens an incident when vacancy is confirmed,
// and stops existing incidents the moment their eligibility ends.
export async function sweepRooms() {
  const breakers = await RoomBreaker.find().select('roomId').lean();
  for (const { roomId } of breakers) {
    const ctx = await getRoomContext(roomId, now());
    if (!ctx) continue;
    const active = await Incident.findOne({ issueKey: `vacancy:${roomId}`, active: true });
    if (active) {
      if (!['shutdown_pending', 'action_sent', 'action_unverified', 'failed'].includes(active.state)) await applyStop(active, ctx);
      continue;
    }
    if (!ctx.occupancy.confirmedVacant || ctx.breaker.supplyState !== 'on' || ctx.protection.protected) continue;
    // After staff resolve an episode, stay quiet until vacancy is established afresh.
    const last = await Incident.findOne({ issueKey: `vacancy:${roomId}`, active: false }).sort({ resolvedAt: -1 }).lean();
    if (last && last.state === 'resolved' && last.resolvedAt && new Date(ctx.occupancy.vacantSince) <= last.resolvedAt) continue;
    await openVacancyIncident(ctx.room, ctx.breaker, ctx.occupancy);
  }
}

export async function workerTick(owner) {
  await sweepRooms();
  return runDueJobs({ owner });
}

export function startWorker() {
  const owner = `worker-${randomUUID().slice(0, 8)}`;
  let busy = false;
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      await workerTick(owner);
    } catch (err) {
      console.error('[worker] tick failed:', err);
    } finally {
      busy = false;
    }
  }, config().workerPollMs);
  timer.unref?.();
  return { owner, stop: () => clearInterval(timer) };
}

export { User };
