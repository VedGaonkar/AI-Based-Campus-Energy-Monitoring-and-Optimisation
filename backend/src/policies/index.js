// Pure policy decisions. No database access here, so every rule is unit-testable.

const STOP_CONFIRMATION_VALID_MINUTES = 60;

// Observed occupancy only. Never derived from timetables, leases or overrides.
export function effectiveOccupancy(room, { freshnessMs, vacancyMs }, at) {
  const o = room.occupancy ?? {};
  const t = new Date(at).getTime();
  if (room.occupancySource === 'none') {
    return { state: 'unknown', confirmedVacant: false, reason: 'no_occupancy_source', fresh: false, dataMode: null };
  }
  if (!o.lastObservationAt) {
    return { state: 'unknown', confirmedVacant: false, reason: 'no_observation', fresh: false, dataMode: null };
  }
  const age = t - new Date(o.lastObservationAt).getTime();
  if (age > freshnessMs) {
    return { state: 'unknown', confirmedVacant: false, reason: 'stale_observation', fresh: false, dataMode: o.dataMode ?? null };
  }
  if (o.state === 'occupied') {
    return { state: 'occupied', confirmedVacant: false, reason: 'person_detected', fresh: true, dataMode: o.dataMode };
  }
  if (o.state === 'vacant' && o.vacantSince) {
    const vacantForMs = t - new Date(o.vacantSince).getTime();
    return {
      state: 'vacant',
      confirmedVacant: vacantForMs >= vacancyMs,
      reason: vacantForMs >= vacancyMs ? 'vacancy_confirmed' : 'vacancy_unconfirmed',
      vacantForMs,
      vacantSince: o.vacantSince,
      fresh: true,
      dataMode: o.dataMode,
    };
  }
  return { state: 'unknown', confirmedVacant: false, reason: o.reason ?? 'unknown', fresh: true, dataMode: o.dataMode ?? null };
}

// Folds one observation into the stored room occupancy. Returns the new occupancy subdocument.
export function applyObservation(room, obs, { freshnessMs }) {
  const prev = room.occupancy ?? {};
  const captured = new Date(obs.capturedAt);
  // An older event must not overwrite newer evidence.
  if (prev.lastObservationAt && captured < new Date(prev.lastObservationAt)) return null;

  const next = {
    state: 'unknown',
    reason: 'unknown',
    lastObservationAt: captured,
    lastOccupiedAt: prev.lastOccupiedAt,
    vacantSince: null,
    dataMode: obs.dataMode,
    sourceId: obs.sourceId,
    equipmentOn: obs.equipmentOn ?? null,
  };
  if (obs.quality?.usable === false) {
    next.reason = obs.quality.reason || 'unusable_observation';
    return next;
  }
  if (obs.occupancy === 'occupied') {
    next.state = 'occupied';
    next.reason = 'person_detected';
    next.lastOccupiedAt = captured;
    return next;
  }
  if (obs.occupancy === 'vacant') {
    if (!room.coverageValidated || !obs.coverageValidated) {
      next.reason = 'coverage_not_validated';
      return next;
    }
    const continuous =
      prev.state === 'vacant' && prev.vacantSince && captured.getTime() - new Date(prev.lastObservationAt).getTime() <= freshnessMs;
    next.state = 'vacant';
    next.reason = 'no_person_detected';
    next.vacantSince = continuous ? prev.vacantSince : captured;
    return next;
  }
  next.reason = 'source_reported_unknown';
  return next;
}

// A booking protects only now or within its preparation window. Tomorrow's class protects nothing today.
export function scheduleProtection(schedules, at, prepMs) {
  const t = new Date(at).getTime();
  return schedules.filter((s) => s.status === 'confirmed' && new Date(s.startAt).getTime() - prepMs <= t && t < new Date(s.endAt).getTime());
}

export function buildProtection({ schedules, leases, overrides }, at, prepMs) {
  const t = new Date(at).getTime();
  const reasons = [];
  for (const s of scheduleProtection(schedules, at, prepMs)) {
    reasons.push({ kind: 'schedule', id: String(s._id), until: s.endAt, text: `Booking "${s.title}"${new Date(s.startAt).getTime() > t ? ' (preparation window)' : ''}` });
  }
  for (const l of leases) {
    if (l.status === 'active' && new Date(l.startAt).getTime() <= t && t < new Date(l.expiresAt).getTime()) {
      reasons.push({ kind: 'lease', id: String(l._id), until: l.expiresAt, text: 'Active QR access lease' });
    }
  }
  for (const o of overrides) {
    if (!o.cancelledAt && new Date(o.startAt).getTime() <= t && t < new Date(o.endAt).getTime()) {
      reasons.push({ kind: 'override', id: String(o._id), until: o.endAt, text: `Staff override: ${o.reason}` });
    }
  }
  return { protected: reasons.length > 0, reasons };
}

// One master feeds every load behind it, so a single unapproved load blocks the whole room cutoff.
export function sharedCutoffBlocks(devices, breaker, at, policyMsFn = (m) => m * 60_000) {
  const blocks = [];
  const t = new Date(at).getTime();
  for (const d of devices) {
    if (d.essential) blocks.push(`${d.name}: essential load is behind the room master`);
    else if (d.essentialStandbyRequirement) blocks.push(`${d.name}: needs standby supply`);
    else if (!d.supplyInterruptionApproved) blocks.push(`${d.name}: supply interruption is not approved`);
    else if (d.requiresNormalStopBeforeCutoff) {
      const confirmed = d.stopProcedureConfirmedAt ? new Date(d.stopProcedureConfirmedAt).getTime() : null;
      const afterLastOn = !breaker?.lastChangedAt || (confirmed && confirmed >= new Date(breaker.lastChangedAt).getTime());
      const recent = confirmed && t - confirmed <= policyMsFn(STOP_CONFIRMATION_VALID_MINUTES);
      if (!confirmed || !afterLastOn || !recent) blocks.push(`${d.name}: normal stop procedure has not been confirmed`);
    }
  }
  return blocks;
}

// Why a vacancy incident must stop. null means it is still eligible.
export function vacancyStopReason({ breaker, occupancy, protection }) {
  if (!breaker) return { kind: 'block', reason: 'No room master is mapped to this room' };
  if (breaker.supplyState === 'off') return { kind: 'resolve', reason: 'Room supply is already OFF' };
  if (occupancy.state === 'occupied') return { kind: 'cancel', reason: 'A person was detected in the room' };
  if (protection.protected) return { kind: 'cancel', reason: protection.reasons[0].text };
  if (occupancy.state === 'unknown') return { kind: 'block', reason: `Occupancy evidence is unknown (${occupancy.reason})` };
  if (!occupancy.confirmedVacant) return { kind: 'cancel', reason: 'Vacancy is no longer confirmed' };
  return null;
}

// Every reason a room-level supply command may not be sent. Empty means eligible.
export function commandBlocks({ room, breaker, devices, occupancy, protection, cfg, at, action, reason, incident, withinAccessHours = true, policyMsFn }) {
  const blocks = [];
  const t = new Date(at).getTime();
  if (!breaker) return ['No room master is mapped to this room'];

  if (room.controlMode === 'alert_only') blocks.push('Room is in alert-only mode');
  if (room.controlMode === 'physical' || breaker.adapter === 'physical') {
    if (cfg.demoMode) blocks.push('Physical control cannot run in demonstration mode');
    else if (!cfg.allowPhysicalControl) blocks.push('Physical control is not armed on the server');
    else if (cfg.deviceAdapter !== 'physical') blocks.push('No physical room-master adapter is configured');
  }
  if (room.controlMode === 'simulated' && breaker.adapter !== 'simulator') blocks.push('Simulated mode requires the simulator adapter');
  if (breaker.health === 'offline') blocks.push('Room master is offline');
  if (breaker.interlocks?.maintenanceLock) blocks.push('Room master is maintenance-locked');
  if (breaker.interlocks?.manualIsolation) blocks.push('Room master is manually isolated');
  if (breaker.interlocks?.faultTripped) blocks.push(action === 'on' ? 'Room master is fault-tripped; it is never restored automatically' : 'Room master is fault-tripped');
  if (breaker.lastChangedAt && breaker.minCycleSeconds > 0 && t - new Date(breaker.lastChangedAt).getTime() < breaker.minCycleSeconds * 1000) {
    blocks.push('Minimum switching cycle has not elapsed');
  }

  if (action === 'off') {
    blocks.push(...sharedCutoffBlocks(devices, breaker, at, policyMsFn));
    if (reason === 'vacancy_escalation') {
      if (!room.autoControlEnabled) blocks.push('Automatic control is not enabled for this room');
      if (!incident || !incident.active) blocks.push('Incident is no longer active');
      if (occupancy.state !== 'vacant' || !occupancy.confirmedVacant) blocks.push(`Room is not confirmed vacant (${occupancy.reason})`);
      if (protection.protected) blocks.push(`Room is protected: ${protection.reasons[0].text}`);
      if (room.controlMode === 'physical' && occupancy.dataMode !== 'live') blocks.push('Only live evidence may authorise a physical action');
    }
    if (reason === 'fixed_duration_expiry') {
      if (room.qrExpiryPolicy !== 'fixed_duration_cutoff') blocks.push('Fixed-duration cutoff is not approved for this room');
      if (protection.protected) blocks.push(`Room is protected: ${protection.reasons[0].text}`);
      if (occupancy.state === 'occupied') blocks.push('A person was detected in the room');
    }
  }

  if (action === 'on') {
    const restartDelay = Math.max(0, ...devices.map((d) => d.restartDelaySeconds ?? 0));
    if (breaker.supplyState !== 'on' && breaker.lastChangedAt && restartDelay > 0 && t - new Date(breaker.lastChangedAt).getTime() < restartDelay * 1000) {
      blocks.push('Appliance restart delay has not elapsed');
    }
    if (reason === 'occupancy_restore') {
      if (!['automation', 'fixed_duration_expiry'].includes(breaker.offReason)) blocks.push('Supply was not switched off by this automation');
      if (!withinAccessHours) blocks.push('Outside permitted access hours');
      if (occupancy.state !== 'occupied') blocks.push('No fresh occupancy evidence');
    }
  }
  return blocks;
}
