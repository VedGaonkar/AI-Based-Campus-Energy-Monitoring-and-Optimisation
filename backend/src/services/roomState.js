import { policyMs } from '../clock.js';
import { AccessLease, Device, Override, Room, RoomBreaker, Schedule } from '../models/index.js';
import { buildProtection, effectiveOccupancy } from '../policies/index.js';
import { localParts } from '../util/time.js';
import { getSettings } from './core.js';

export function occupancyLimits(settings) {
  return {
    // Freshness follows the source cadence and is real time, never accelerated.
    freshnessMs: settings.policies.observationFreshnessSeconds * 1000,
    vacancyMs: policyMs(settings.policies.vacancyConfirmationMinutes),
  };
}

export async function getProtection(roomId, at, settings) {
  const prepMs = policyMs(settings.policies.bookingPreparationMinutes);
  const t = new Date(at);
  const [schedules, leases, overrides] = await Promise.all([
    Schedule.find({ roomId, status: 'confirmed', endAt: { $gt: t }, startAt: { $lte: new Date(t.getTime() + prepMs) } }).lean(),
    AccessLease.find({ roomId, status: 'active', expiresAt: { $gt: t } }).lean(),
    Override.find({ roomId, cancelledAt: null, endAt: { $gt: t }, startAt: { $lte: t } }).lean(),
  ]);
  return buildProtection({ schedules, leases, overrides }, t, prepMs);
}

export function withinAccessHours(at, settings) {
  const { hour } = localParts(at, settings.timezone);
  return hour >= settings.policies.accessStartHour && hour < settings.policies.accessEndHour;
}

// Everything a policy decision needs, reloaded from the database at the moment of the decision.
export async function getRoomContext(roomId, at) {
  const settings = await getSettings();
  const [room, breaker, devices] = await Promise.all([
    Room.findById(roomId),
    RoomBreaker.findOne({ roomId }),
    Device.find({ roomId }).lean(),
  ]);
  if (!room) return null;
  const occupancy = effectiveOccupancy(room, occupancyLimits(settings), at);
  const protection = await getProtection(roomId, at, settings);
  return { settings, room, breaker, devices, occupancy, protection, withinAccessHours: withinAccessHours(at, settings) };
}
