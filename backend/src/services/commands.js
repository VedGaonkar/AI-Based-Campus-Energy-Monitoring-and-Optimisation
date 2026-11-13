import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { now, policyMs } from '../clock.js';
import { getRoomMasterAdapter } from '../adapters/roomMaster.js';
import { Command, Device, RoomBreaker } from '../models/index.js';
import { commandBlocks } from '../policies/index.js';
import { audit, conflict, emitLive, notFound } from './core.js';
import { getRoomContext } from './roomState.js';

const LOCK_MS = 15_000;
const OFF_REASON = { vacancy_escalation: 'automation', fixed_duration_expiry: 'fixed_duration_expiry' };

function blocksFor(ctx, { action, reason, incident }) {
  return commandBlocks({
    room: ctx.room,
    breaker: ctx.breaker,
    devices: ctx.devices,
    occupancy: ctx.occupancy,
    protection: ctx.protection,
    cfg: config(),
    at: now(),
    action,
    reason,
    incident,
    withinAccessHours: ctx.withinAccessHours,
    policyMsFn: policyMs,
  });
}

async function finish(command, patch) {
  Object.assign(command, patch);
  await command.save();
  await emitLive('command.updated', { roomId: command.roomId, payload: { requestId: command.requestId, status: command.status } });
  return command;
}

// The only path that changes a room supply. One room, one master, one explicit ON or OFF.
export async function issueSupplyCommand({ roomId, action, reason, incident, leaseId, actor }) {
  let ctx = await getRoomContext(roomId, now());
  if (!ctx) throw notFound('Room');
  if (!ctx.breaker) throw conflict('no_room_master', 'No room master is mapped to this room');
  const { settings } = ctx;
  const issuedAt = now();

  // Persist intent before any transport so a crash never loses the record of what was attempted.
  const command = await Command.create({
    requestId: randomUUID(),
    roomId,
    roomBreakerId: ctx.breaker._id,
    roomBreakerCode: ctx.breaker.code,
    action,
    reason,
    incidentId: incident?._id,
    leaseId,
    policyVersion: ctx.room.policyVersion,
    issuedAt,
    expiresAt: new Date(issuedAt.getTime() + settings.policies.commandExpirySeconds * 1000),
    actorId: actor?._id,
    actorLabel: actor?.name ?? 'system',
    dataMode: ctx.breaker.adapter === 'simulator' ? 'simulated' : 'live',
  });

  let blocks = blocksFor(ctx, { action, reason, incident });
  if (blocks.length) return finish(command, { status: 'rejected', rejectReasons: blocks, transportStatus: 'not_sent' });

  // One in-flight command per room master, so simultaneous requests cannot conflict.
  const lockUntil = new Date(now().getTime() + LOCK_MS);
  const locked = await RoomBreaker.findOneAndUpdate(
    { _id: ctx.breaker._id, $or: [{ commandLockUntil: null }, { commandLockUntil: { $lt: now() } }] },
    { $set: { commandLockUntil: lockUntil, commandLockRequestId: command.requestId } },
    { returnDocument: 'after' },
  );
  if (!locked) {
    return finish(command, { status: 'rejected', rejectReasons: ['Another command is in flight for this room master'], transportStatus: 'not_sent' });
  }

  try {
    // Evidence can change while waiting for the lock: decide again on fresh state.
    ctx = await getRoomContext(roomId, now());
    blocks = blocksFor(ctx, { action, reason, incident });
    if (ctx.room.policyVersion !== command.policyVersion) blocks.push('Room policy changed after the command was created');
    if (blocks.length) return await finish(command, { status: 'rejected', rejectReasons: blocks, transportStatus: 'not_sent' });
    if (now() > command.expiresAt) return await finish(command, { status: 'expired', transportStatus: 'not_sent' });

    const adapter = getRoomMasterAdapter(ctx.breaker);
    const result = await adapter.setSupply(ctx.breaker, action === 'on', command.requestId, command.expiresAt);
    if (result.expired) return await finish(command, { status: 'expired', transportStatus: 'not_sent' });

    const acknowledged = result.transportStatus === 'acknowledged';
    const breakerPatch = { lastSeenAt: now(), lastVerification: result.verification };
    if (acknowledged) {
      // Without controller feedback the output is not known; never assume it obeyed.
      breakerPatch.supplyState = result.reportedOutput ?? 'unknown';
      breakerPatch.lastChangedAt = now();
      breakerPatch.offReason = action === 'off' ? (OFF_REASON[reason] ?? 'manual') : null;
      if (action === 'on') {
        // A stop confirmation describes one shutdown only.
        await Device.updateMany({ roomId }, { $unset: { stopProcedureConfirmedAt: 1, stopProcedureConfirmedBy: 1 } });
      }
    }
    await RoomBreaker.updateOne({ _id: ctx.breaker._id }, { $set: breakerPatch });

    await finish(command, {
      status: acknowledged ? 'completed' : 'failed',
      transportStatus: result.transportStatus,
      reportedOutput: result.reportedOutput,
      verification: result.verification,
      verifiedAt: result.verifiedAt,
      dataMode: result.dataMode,
    });
    await audit(actor, `supply.${action}`, 'room', roomId, { requestId: command.requestId, reason, verification: result.verification, dataMode: result.dataMode });
    await emitLive('room.updated', { roomId });
    return command;
  } finally {
    await RoomBreaker.updateOne({ _id: ctx.breaker._id, commandLockRequestId: command.requestId }, { $set: { commandLockUntil: null, commandLockRequestId: null } });
  }
}

// OFF is confirmed only when something other than the request itself reports it.
export function commandConfirmedOff(command) {
  return command.status === 'completed' && command.reportedOutput === 'off' && ['simulated', 'controller_reported', 'independently_metered'].includes(command.verification);
}

export function commandResultView(command) {
  return {
    requestId: command.requestId,
    roomId: String(command.roomId),
    roomBreakerId: command.roomBreakerCode,
    action: command.action,
    reason: command.reason,
    incidentId: command.incidentId ? String(command.incidentId) : null,
    policyVersion: command.policyVersion,
    issuedAt: command.issuedAt,
    expiresAt: command.expiresAt,
    actor: command.actorLabel,
    status: command.status,
    rejectReasons: command.rejectReasons,
    transportStatus: command.transportStatus,
    reportedOutput: command.reportedOutput,
    verification: command.verification,
    verifiedAt: command.verifiedAt ?? null,
    dataMode: command.dataMode,
  };
}
