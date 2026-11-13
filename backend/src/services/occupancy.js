import { now } from '../clock.js';
import { Integration, Observation, Room, RoomBreaker } from '../models/index.js';
import { applyObservation } from '../policies/index.js';
import { parseIsoDate } from '../util/time.js';
import { badRequest, emitLive, forbidden, getSettings } from './core.js';
import { issueSupplyCommand } from './commands.js';
import { cancelActiveVacancyIncident } from './incidents.js';

const FUTURE_TOLERANCE_MS = 2 * 60_000;

// Restores a supply only when this automation switched it off. Fault trips and locks stay off.
export async function restoreSupplyOnOccupancy(roomId) {
  const breaker = await RoomBreaker.findOne({ roomId }).lean();
  if (!breaker || breaker.supplyState === 'on' || !['automation', 'fixed_duration_expiry'].includes(breaker.offReason)) return null;
  return issueSupplyCommand({ roomId, action: 'on', reason: 'occupancy_restore', actor: { label: 'automation' } });
}

// Accepts one observation from a registered source. The source decides nothing:
// room mapping, freshness and the resulting room state are all computed here.
export async function ingestObservation(payload, { forceDataMode } = {}) {
  const integration = await Integration.findOne({ sourceId: payload.sourceId, type: { $in: ['camera', 'presence_sensor'] } });
  if (!integration || !integration.enabled) throw forbidden('Unknown or disabled observation source');
  if (!integration.roomId) throw badRequest('source_unmapped', 'This source is not mapped to a room');

  const capturedAt = parseIsoDate(payload.capturedAt);
  if (!capturedAt) throw badRequest('invalid_timestamp', 'capturedAt must be an ISO 8601 timestamp with a UTC offset');
  if (capturedAt.getTime() > now().getTime() + FUTURE_TOLERANCE_MS) throw badRequest('future_timestamp', 'capturedAt is in the future');

  // Replayed clips and fixtures can never be promoted to live evidence by the sender.
  const dataMode = forceDataMode ?? (integration.dataMode !== 'live' ? integration.dataMode : payload.dataMode === 'live' ? 'live' : payload.dataMode);
  const settings = await getSettings();
  const room = await Room.findById(integration.roomId);

  let observation;
  try {
    observation = await Observation.create({
      eventId: payload.eventId,
      sourceId: payload.sourceId,
      roomId: room._id,
      capturedAt,
      receivedAt: now(),
      sourceType: integration.type,
      occupancy: payload.occupancy,
      detectedPeople: payload.detectedPeople,
      confidence: payload.confidence,
      coverageValidated: Boolean(payload.coverageValidated),
      quality: payload.quality ?? { usable: true },
      equipmentOn: payload.equipmentOn ?? null,
      dataMode,
      modelVersion: payload.modelVersion,
    });
  } catch (err) {
    if (err.code === 11000) return { duplicate: true, roomId: String(room._id) };
    throw err;
  }

  await Integration.updateOne({ _id: integration._id }, { $set: { lastSeenAt: now(), health: 'connected' } });

  const next = applyObservation(room, observation, { freshnessMs: settings.policies.observationFreshnessSeconds * 1000 });
  if (!next) return { duplicate: false, stale: true, roomId: String(room._id) };
  room.occupancy = next;
  await room.save();

  let restore = null;
  if (next.state === 'occupied') {
    // Positive occupancy immediately invalidates any pending vacancy action.
    await cancelActiveVacancyIncident(room._id, 'A person was detected in the room');
    restore = await restoreSupplyOnOccupancy(room._id);
  }
  await emitLive('room.updated', { roomId: room._id });
  return { duplicate: false, roomId: String(room._id), occupancy: next.state, reason: next.reason, restoreCommand: restore?.requestId ?? null };
}
