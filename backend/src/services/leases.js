import { now, policyMs } from '../clock.js';
import { AccessLease, Override, Room, RoomBreaker, Schedule } from '../models/index.js';
import { audit, badRequest, conflict, emitLive, forbidden, getSettings, notFound } from './core.js';
import { issueSupplyCommand } from './commands.js';
import { cancelActiveVacancyIncident, cancelJobs, createJob } from './incidents.js';
import { withinAccessHours } from './roomState.js';

const LEASE_ROLES = ['admin', 'hod', 'first_responder', 'teacher'];

export function canUseRoom(user, roomId) {
  if (user.role === 'admin') return true;
  return (user.permittedRoomIds ?? []).some((id) => String(id) === String(roomId));
}

async function scheduleLeaseJobs(lease, settings) {
  await cancelJobs({ leaseId: lease._id }, 'Lease changed');
  const warnAt = new Date(lease.expiresAt.getTime() - policyMs(settings.policies.qrExpiryWarningMinutes));
  const stamp = lease.expiresAt.getTime();
  if (warnAt > now()) {
    await createJob({ type: 'lease_warning', leaseId: lease._id, roomId: lease.roomId, dueAt: warnAt, idempotencyKey: `${lease._id}:lease_warning:${stamp}` });
  }
  await createJob({ type: 'lease_expiry', leaseId: lease._id, roomId: lease.roomId, dueAt: lease.expiresAt, idempotencyKey: `${lease._id}:lease_expiry:${stamp}` });
}

async function checkWindow(room, user, from, until, settings) {
  if (!withinAccessHours(from, settings)) throw forbidden('Outside permitted access hours');
  // Another group's confirmed booking inside the requested window is a conflict, not something to override silently.
  const clash = await Schedule.findOne({ roomId: room._id, status: 'confirmed', startAt: { $lt: until, $gt: from } }).lean();
  if (clash && !['admin', 'hod'].includes(user.role)) {
    throw conflict('booking_conflict', `Conflicts with the booking "${clash.title}" starting ${clash.startAt.toISOString()}; shorten the request or ask an administrator`);
  }
}

export async function createLease(roomId, user, { durationMinutes, acceptPolicy }) {
  const settings = await getSettings();
  const room = await Room.findById(roomId);
  if (!room) throw notFound('Room');
  if (!LEASE_ROLES.includes(user.role) || !canUseRoom(user, roomId)) throw forbidden('You are not authorised to request supply for this room');
  if (!acceptPolicy) throw badRequest('policy_not_accepted', 'The room access policy must be accepted');
  if (!(durationMinutes > 0) || durationMinutes > settings.policies.qrMaxDurationMinutes) {
    throw badRequest('invalid_duration', `Duration must be between 1 and ${settings.policies.qrMaxDurationMinutes} minutes`);
  }
  const breaker = await RoomBreaker.findOne({ roomId }).lean();
  if (breaker && (breaker.interlocks.faultTripped || breaker.interlocks.maintenanceLock || breaker.interlocks.manualIsolation)) {
    throw conflict('room_locked_out', 'The room supply is locked out for a fault or maintenance; contact facilities staff');
  }
  const existing = await AccessLease.findOne({ roomId, status: 'active', expiresAt: { $gt: now() } });
  if (existing) throw conflict('lease_exists', 'This room already has an active access lease; extend it instead');

  const startAt = now();
  const expiresAt = new Date(startAt.getTime() + policyMs(durationMinutes));
  await checkWindow(room, user, startAt, expiresAt, settings);

  const lease = await AccessLease.create({
    roomId,
    requesterId: user._id,
    requestedMinutes: durationMinutes,
    startAt,
    expiresAt,
    policyAccepted: true,
    dataMode: breaker?.adapter === 'simulator' || !breaker ? 'simulated' : 'live',
  });
  await scheduleLeaseJobs(lease, settings);
  // A lease is authorised use: old vacancy and expiry shutdown work is now obsolete.
  await cancelActiveVacancyIncident(roomId, 'An authorised QR access lease started', user);

  let command = null;
  if (breaker && breaker.supplyState !== 'on') {
    command = await issueSupplyCommand({ roomId, action: 'on', reason: 'qr_access', leaseId: lease._id, actor: user });
  }
  await audit(user, 'lease.create', 'room', roomId, { leaseId: lease._id, durationMinutes });
  await emitLive('room.updated', { roomId });
  return { lease, command };
}

export async function extendLease(leaseId, user, { additionalMinutes }) {
  const settings = await getSettings();
  const lease = await AccessLease.findById(leaseId);
  if (!lease) throw notFound('Access lease');
  if (lease.status !== 'active' || lease.expiresAt <= now()) throw conflict('lease_not_active', 'This lease is no longer active');
  if (String(lease.requesterId) !== String(user._id) && !['admin', 'hod'].includes(user.role)) throw forbidden('Only the requester or a senior role can extend this lease');
  if (!canUseRoom(user, lease.roomId)) throw forbidden();
  if (!(additionalMinutes > 0)) throw badRequest('invalid_duration', 'additionalMinutes must be positive');
  const newExpiry = new Date(lease.expiresAt.getTime() + policyMs(additionalMinutes));
  if (newExpiry.getTime() - now().getTime() > policyMs(settings.policies.qrMaxDurationMinutes)) {
    throw badRequest('exceeds_maximum', `A lease may not run more than ${settings.policies.qrMaxDurationMinutes} minutes ahead`);
  }
  const room = await Room.findById(lease.roomId);
  await checkWindow(room, user, lease.expiresAt, newExpiry, settings);

  lease.extensions.push({ at: now(), minutes: additionalMinutes, by: user._id, previousExpiresAt: lease.expiresAt });
  lease.expiresAt = newExpiry;
  lease.warningSentAt = undefined;
  await lease.save();
  await scheduleLeaseJobs(lease, settings);
  await audit(user, 'lease.extend', 'room', lease.roomId, { leaseId, additionalMinutes });
  await emitLive('room.updated', { roomId: lease.roomId });
  return lease;
}

export async function endLease(leaseId, user) {
  const lease = await AccessLease.findById(leaseId);
  if (!lease) throw notFound('Access lease');
  if (String(lease.requesterId) !== String(user._id) && !['admin', 'hod'].includes(user.role)) throw forbidden();
  if (lease.status !== 'active') throw conflict('lease_not_active', 'This lease is no longer active');
  lease.status = 'ended';
  lease.endedAt = now();
  lease.endReason = 'Ended by user';
  await lease.save();
  await cancelJobs({ leaseId: lease._id }, 'Lease ended');
  await audit(user, 'lease.end', 'room', lease.roomId, { leaseId });
  await emitLive('room.updated', { roomId: lease.roomId });
  return lease;
}

export async function createOverride(roomId, user, { reason, durationMinutes }) {
  const room = await Room.findById(roomId);
  if (!room) throw notFound('Room');
  if (!LEASE_ROLES.includes(user.role) || !canUseRoom(user, roomId)) throw forbidden('You are not authorised to override this room');
  if (!(durationMinutes > 0) || durationMinutes > 480) throw badRequest('invalid_duration', 'Duration must be between 1 and 480 minutes');
  const startAt = now();
  const override = await Override.create({ roomId, createdBy: user._id, reason, startAt, endAt: new Date(startAt.getTime() + policyMs(durationMinutes)) });
  await cancelActiveVacancyIncident(roomId, `Staff override: ${reason}`, user);
  await audit(user, 'override.create', 'room', roomId, { overrideId: override._id, reason, durationMinutes });
  await emitLive('room.updated', { roomId });
  return override;
}

export async function endOverride(overrideId, user) {
  const override = await Override.findById(overrideId);
  if (!override) throw notFound('Override');
  if (String(override.createdBy) !== String(user._id) && !['admin', 'hod'].includes(user.role)) throw forbidden();
  if (override.cancelledAt || override.endAt <= now()) throw conflict('override_not_active', 'This override is no longer active');
  override.cancelledAt = now();
  override.cancelledBy = user._id;
  await override.save();
  await audit(user, 'override.end', 'room', override.roomId, { overrideId });
  await emitLive('room.updated', { roomId: override.roomId });
  return override;
}
