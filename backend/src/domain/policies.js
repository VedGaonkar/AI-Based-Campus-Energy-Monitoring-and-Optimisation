import { calendar } from "./energy.js";
const at = (value) => new Date(value).getTime();

export function occupancy(
  room,
  observations,
  sources,
  now,
  { confirmationMs = 900000, demoMode = false } = {},
) {
  const usable = observations.filter(
    (o) =>
      at(o.capturedAt) <= at(now) + 5000 && (demoMode || o.dataMode === "live"),
  );
  const latest = sources.map((source) => ({
    source,
    records: usable
      .filter((o) => o.sourceId === source._id)
      .sort((a, b) => at(b.capturedAt) - at(a.capturedAt)),
  }));
  const fresh = ({ source, records }) =>
    records[0] &&
    source.health === "online" &&
    at(now) - at(records[0].capturedAt) <= source.freshnessSeconds * 1000 &&
    records[0].quality?.usable;
  if (
    latest.some(
      (s) =>
        fresh(s) &&
        s.records[0].occupancy === "occupied" &&
        s.records[0].confidence >= 0.5,
    )
  )
    return {
      state: "occupied",
      reason: "Fresh positive presence",
      dataMode: latest.some((s) => s.records[0]?.dataMode !== "live")
        ? "simulated"
        : "live",
    };
  const required = latest.filter((s) =>
    room.requiredSourceIds.includes(s.source._id),
  );
  if (
    !room.coverageValidated ||
    !required.length ||
    required.length !== room.requiredSourceIds.length ||
    required.some(
      (s) =>
        !fresh(s) ||
        !s.source.coverageValidated ||
        s.records[0].occupancy !== "vacant" ||
        !s.records[0].coverageValidated,
    )
  )
    return {
      state: "unknown",
      reason: "Coverage, freshness or required sources unavailable",
    };
  let since = 0;
  for (const { source, records } of required) {
    let oldest = records[0];
    for (let i = 1; i < records.length; i++) {
      if (
        records[i].occupancy !== "vacant" ||
        !records[i].quality?.usable ||
        !records[i].coverageValidated ||
        at(oldest.capturedAt) - at(records[i].capturedAt) >
          source.freshnessSeconds * 1000
      )
        break;
      oldest = records[i];
    }
    since = Math.max(since, at(oldest.capturedAt));
  }
  return at(now) - since >= confirmationMs
    ? {
        state: "vacant",
        since: new Date(since),
        reason: "Confirmed within validated coverage",
        dataMode: required.every((s) => s.records[0].dataMode === "live")
          ? "live"
          : "simulated",
      }
    : {
        state: "unknown",
        since: new Date(since),
        reason: "Vacancy confirmation in progress",
      };
}

export function protection(
  room,
  schedules,
  leases,
  overrides,
  now,
  preparationMs = 900000,
) {
  const valid = (item) => item.roomId === room._id && !item.endedAt;
  if (
    overrides.some(
      (o) => valid(o) && at(o.startAt) <= at(now) && at(o.expiresAt) > at(now),
    )
  )
    return "staff_override";
  if (
    leases.some(
      (l) => valid(l) && at(l.startAt) <= at(now) && at(l.expiresAt) > at(now),
    )
  )
    return "access_lease";
  if (
    schedules.some(
      (s) =>
        s.roomId === room._id &&
        s.status === "confirmed" &&
        at(s.startAt) - preparationMs <= at(now) &&
        at(s.endAt) > at(now),
    )
  )
    return "booking";
  return null;
}

export function supplyEligibility({
  room,
  breaker,
  devices,
  observed,
  protectedBy,
  action,
  reason,
  now,
  config,
  policyVersion,
  expiresAt,
}) {
  const blocked = (message) => ({ allowed: false, reason: message });
  if (
    !breaker ||
    room.roomBreakerId !== breaker._id ||
    breaker.roomId !== room._id
  )
    return blocked("Room master mapping is invalid");
  if (
    breaker.health !== "online" ||
    breaker.faultTripped ||
    breaker.maintenanceLocked ||
    breaker.manuallyIsolated ||
    !breaker.interlocksKnown
  )
    return blocked(
      "Breaker offline, isolated, faulted or interlock status unknown",
    );
  if (!room.independentInfrastructure || !devices.length)
    return blocked(
      "Independent protected supplies and complete inventory required",
    );
  if (
    devices.some(
      (d) =>
        d.essential ||
        d.essentialStandbyRequirement ||
        !d.supplyInterruptionApproved,
    )
  )
    return blocked("A downstream load blocks shared cutoff");
  if (expiresAt && at(expiresAt) <= at(now)) return blocked("Command expired");
  if (policyVersion !== undefined && policyVersion !== room.policyVersion)
    return blocked("Policy version changed");
  if (
    config.deviceAdapter !== "simulator" ||
    !config.demoMode ||
    config.allowPhysicalControl
  )
    return blocked("No commissioned physical adapter is installed");
  if (action === "off") {
    if (
      devices.some(
        (d) =>
          d.requiresNormalStopBeforeCutoff &&
          (!d.stopProcedureConfirmedAt ||
            (d.lastRestartAt &&
              at(d.lastRestartAt) >= at(d.stopProcedureConfirmedAt))),
      )
    )
      return blocked("An approved normal-stop confirmation is required");
    if (reason === "vacancy_escalation") {
      if (room.controlMode !== "simulated")
        return blocked("Room is alert-only");
      if (observed.state !== "vacant" || protectedBy)
        return blocked("Occupancy or authorised use protects this room");
    }
  } else {
    if (reason === "occupancy_restore" && !breaker.automationDisabled)
      return blocked("Supply was not disabled by this automation");
    if (
      breaker.reportedSupply !== "on" &&
      breaker.lastChangedAt &&
      devices.some(
        (d) =>
          at(now) - at(breaker.lastChangedAt) <
          (d.restartDelaySeconds ?? 0) * 1000,
      )
    )
      return blocked("Appliance restart delay is active");
  }
  return {
    allowed: true,
    reason: "Eligible simulated room supply action",
    dataMode: "simulated",
  };
}

export function accessAllowed(room, schedules, start, end, timezone) {
  const a = calendar(start, timezone),
    b = calendar(new Date(at(end) - 1), timezone);
  if (
    a.date !== b.date ||
    a.hour < room.allowedStartHour ||
    b.hour >= room.allowedEndHour
  )
    return "Outside permitted room hours";
  if (
    schedules.some(
      (s) =>
        s.roomId === room._id &&
        s.status === "confirmed" &&
        at(s.startAt) < at(end) &&
        at(s.endAt) > at(start),
    )
  )
    return "Conflicts with a confirmed booking";
  return null;
}
