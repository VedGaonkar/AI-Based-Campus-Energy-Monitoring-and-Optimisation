import { occupancy, protection } from "../domain/policies.js";
import { HttpError } from "../security/access.js";

export async function roomContext(models, room, config, now = new Date()) {
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
  const availableSources = sources.filter((source) => source.type !== "camera" || !room.cameraConfiguration || room.cameraConfiguration === "installed");
  return {
    room,
    breaker,
    devices,
    observed: occupancy(room, observations, availableSources, now, {
      confirmationMs: config.vacancyMs,
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
  const settings = await models.Settings.findById("installation").lean();
  if (!settings)
    throw new HttpError(
      503,
      "NOT_SEEDED",
      "Run the documented seed command first",
    );
  return settings;
}
export async function cancelRoomWork(models, roomId, reason, now = new Date()) {
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
