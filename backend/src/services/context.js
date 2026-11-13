import { occupancy, protection } from "../domain/policies.js";
import { HttpError } from "../security/access.js";
import { activePhoneDemo } from "./demo-session-state.js";

export async function roomContext(models, room, config, now = new Date()) {
  const demoSession = await activePhoneDemo(models, room, config, now);
  const since = new Date(
    now.getTime() - Math.max(config.vacancyMs + 120000, 240000),
  );
  const [
    breaker,
    devices,
    observations,
    sources,
    schedules,
    leases,
    overrides,
  ] = await Promise.all([
    models.Breaker.findById(room.roomBreakerId).lean(),
    models.Device.find({ roomId: room._id }).lean(),
    models.Observation.find({
      roomId: room._id,
      capturedAt: { $gte: since, $lte: new Date(now.getTime() + 5000) },
    })
      .sort({ capturedAt: -1 })
      .limit(5000)
      .lean(),
    models.Integration.find({
      roomId: room._id,
      type: { $in: ["camera", "presence"] },
    }).lean(),
    models.Schedule.find({
      roomId: room._id,
      endAt: { $gt: now },
      startAt: { $lte: new Date(now.getTime() + config.preparationMs) },
    }).lean(),
    models.AccessLease.find({
      roomId: room._id,
      endedAt: null,
      expiresAt: { $gt: now },
    }).lean(),
    models.Override.find({
      roomId: room._id,
      endedAt: null,
      expiresAt: { $gt: now },
    }).lean(),
  ]);
  const availableSources = sources.filter((source) => (!room.demoSessionId || (demoSession && source._id === demoSession.sourceId)) && (source.type !== "camera" || !room.cameraConfiguration || room.cameraConfiguration === "installed"));
  const nativePrerequisites = [];
  for (const load of devices.filter((item) => item.nativeOffRequired)) {
    const target = await models.ConnectedDevice.findOne({ inventoryId: load._id, roomId: room._id, enabled: true }).lean();
    const command = target && await models.NativeCommand.findOne({ deviceId: target._id }).sort({ createdAt: -1 }).lean();
    const nativeConnection = target && await models.DeviceConnection.findById(target.connectionId).lean();
    nativePrerequisites.push({ inventoryId: load._id, satisfied: !!(target && command && target.lastState?.state === "off" &&
      ["confirmed", "already_off"].includes(command.status) && nativeConnection?.enabled && nativeConnection.health === "online" &&
      command.connectionRevision === nativeConnection.revision &&
      target.lastState?.optimistic !== true && target.identityStatus === "reviewed" && target.manualOffAllowed &&
      command.deviceRevision === target.revision && now - new Date(target.lastState.observedAt) <= 30000 &&
      command.verification === "simulated" && config.demoMode), reason: "A required native OFF needs fresh matching confirmation before any dependent room cutoff" });
  }
  return {
    room,
    breaker,
    devices,
    nativePrerequisites,
    demoSession,
    observed: occupancy(room, observations, availableSources, now, {
      confirmationMs: demoSession?.vacancyConfirmationMs ?? config.vacancyMs,
      demoMode: config.demoMode,
    }),
    protectedBy: protection(
      room,
      schedules,
      leases,
      overrides,
      now,
      config.preparationMs,
    ),
    sources,
    leases,
    overrides,
    schedules,
  };
}
export async function audit(models, actorId, action, target, summary = "") {
  await models.AuditEvent.create({ actorId, action, target, summary });
}
export async function getSettings(models) {
  // Only declared installation fields may leave storage. Legacy/foreign secret
  // fields in Mongo must neither configure authentication nor appear in APIs.
  const settings = await models.Settings.findById("installation").select(Object.keys(models.Settings.schema.paths).join(" ")).lean();
  if (!settings)
    throw new HttpError(
      503,
      "NOT_SEEDED",
      "Run the documented seed command first",
    );
  return settings;
}
export async function cancelRoomWork(models, roomId, reason, now = new Date()) {
  for (const state of ["pending", "sent"]) await models.Command.updateMany({ roomId, demoSessionId: { $exists: true }, action: "off", reason: "vacancy_escalation", state }, {
    $set: { state: state === "sent" ? "unverified" : "cancelled", result: { verification: "unknown", dataMode: "simulated", reason } },
    $push: { timeline: { at: now, event: state === "sent" ? "unverified_after_cancellation" : "cancelled", reason } },
  });
  await models.NativeCommand.updateMany({ roomId, status: "requested" }, {
    $set: { status: "cancelled", errorCode: "ROOM_POLICY_CANCELLED" }, $push: { timeline: { at: now, status: "cancelled", reason } },
  });
  await models.NativeCommand.updateMany({ roomId, status: { $in: ["dispatched", "accepted"] } }, {
    $set: { status: "unverified", errorCode: "ROOM_POLICY_CANCELLED_AFTER_DISPATCH" }, $push: { timeline: { at: now, status: "unverified", reason } },
  });
  await models.Job.updateMany({ roomId, kind: "native_off", status: { $in: ["pending", "leased"] } }, { $set: { status: "cancelled" } });
  const incidents = await models.Incident.find({
    roomId,
    active: true,
    type: "vacancy",
  }).lean();
  for (const incident of incidents) {
    await models.Incident.updateOne(
      { _id: incident._id, active: true },
      {
        $set: { active: false, state: "cancelled" },
        $push: { timeline: { at: now, event: "cancelled", reason } },
      },
    );
    await models.Job.updateMany(
      { incidentId: incident._id, status: { $in: ["pending", "leased"] } },
      { $set: { status: "cancelled" } },
    );
  }
}
