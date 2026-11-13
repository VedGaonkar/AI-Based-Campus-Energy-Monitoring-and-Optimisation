export function demoRoomUnavailable(room, breaker, devices) {
  if (room.demoSessionId) return "A phone demo already owns this room; stop that session first.";
  if ((room.nativeOffMode ?? "alert_only") !== "alert_only") return "Native appliance automation is enabled; set its room policy to alert-only first.";
  if (!breaker || breaker.roomId !== room._id || (breaker.adapter ?? "simulator") !== "simulator") return "A correctly mapped simulated room master is required.";
  if (breaker.health !== "online" || !breaker.interlocksKnown || breaker.faultTripped || breaker.maintenanceLocked || breaker.manuallyIsolated) return "The room master is offline, locked, faulted or has unknown interlocks.";
  if (!room.independentInfrastructure) return "Independent camera/network/control supplies need review.";
  if (!devices.length) return "Add and review this room's load inventory first.";
  if (devices.some(load => load.essential || load.essentialStandbyRequirement || !load.supplyInterruptionApproved)) return "A load is protected or has not been approved for shared cutoff.";
  return null;
}
