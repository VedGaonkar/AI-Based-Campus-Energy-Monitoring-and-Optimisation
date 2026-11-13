import { randomUUID } from "node:crypto";
import { roomContext, cancelRoomWork, audit } from "../services/context.js";
import { withRoomLock } from "../security/access.js";
import { createRoomMaster } from "../adapters/room-master.js";

export async function ensureIncidentJobs(models, incident, config) {
  const stages = [
    ["first", 0],
    ["second", config.firstEscalationMs],
    ["final", config.firstEscalationMs + config.finalAdditionalMs],
  ];
  for (const [stage, delay] of stages)
    await models.Job.updateOne(
      { _id: `${incident._id}:${stage}` },
      {
        $setOnInsert: {
          incidentId: incident._id,
          roomId: incident.roomId,
          stage,
          dueAt: new Date(new Date(incident.openedAt).getTime() + delay),
          policyVersion: incident.policyVersion,
          status: "pending",
        },
      },
      { upsert: true },
    );
}
async function notify(models, incident, stage, now) {
  const requested =
    stage === "second" ? incident.secondResponderId : incident.firstResponderId;
  let recipient = await models.User.findOne({
    _id: requested,
    active: true,
  }).lean();
  if (!recipient && incident.backupResponderId)
    recipient = await models.User.findOne({
      _id: incident.backupResponderId,
      active: true,
    }).lean();
  if (!recipient)
    recipient = await models.User.findOne({
      role: "admin",
      active: true,
    }).lean();
  const key = `${incident._id}:${stage}:${recipient?._id ?? "unassigned"}:in_app`;
  await models.Notification.updateOne(
    { idempotencyKey: key },
    {
      $setOnInsert: {
        incidentId: incident._id,
        roomId: incident.roomId,
        stage,
        recipientId: recipient?._id ?? "unassigned",
        title: incident.title,
        message: `${stage === "second" ? "Escalated: " : ""}Inspect the room and record an action. Acknowledgement alone does not resolve this issue.`,
        state: recipient ? "delivered" : "failed",
        dueAt: now,
        idempotencyKey: key,
      },
    },
    { upsert: true },
  );
}

async function fixtureHeartbeat(models, config, now) {
  if (!config.demoMode) return;
  const rooms = await models.Room.find({
    demoScenario: { $in: ["occupied", "vacant", "offline"] },
    demoUntil: { $gt: now },
  }).lean();
  for (const room of rooms)
    await withRoomLock(
      models,
      room._id,
      async () => {
        for (const sourceId of room.requiredSourceIds) {
          const source = await models.Integration.findById(sourceId).lean();
          if (!source) continue;
          await models.Integration.updateOne(
            { _id: sourceId },
            {
              $set: {
                health: room.demoScenario === "offline" ? "offline" : "online",
                lastSeenAt: now,
              },
            },
          );
          if (room.demoScenario === "offline") continue;
          await models.Observation.create({
            eventId: randomUUID(),
            sourceId,
            roomId: room._id,
            capturedAt: now,
            receivedAt: now,
            sourceType: source.type,
            occupancy: room.demoScenario,
            detectedPeople: room.demoScenario === "occupied" ? 1 : 0,
            confidence: 1,
            coverageValidated: source.coverageValidated,
            quality: {
              usable: true,
              reason: "Explicit synthetic demo fixture; not model inference",
            },
            dataMode: "simulated",
            modelVersion: "fixture-v1",
          });
        }
      },
      now,
    );
}

export async function tick(
  models,
  config,
  now = new Date(),
  workerId = randomUUID(),
) {
  const adapter = createRoomMaster(models, config);
  await fixtureHeartbeat(models, config, now);
  const rooms = await models.Room.find().lean();
  for (const initial of rooms) {
    try {
      await withRoomLock(
        models,
        initial._id,
        async (room) => {
          const context = await roomContext(models, room, config, now);
          if (context.observed.state !== "vacant")
            await models.Device.updateMany(
              { roomId: room._id, requiresNormalStopBeforeCutoff: true },
              { $set: { stopProcedureConfirmedAt: null } },
            );
          if (
            context.observed.state !== "vacant" ||
            context.protectedBy ||
            context.breaker?.reportedSupply === "off"
          ) {
            await cancelRoomWork(
              models,
              room._id,
              context.protectedBy ?? context.observed.reason,
              now,
            );
            if (
              context.observed.state === "occupied" &&
              context.breaker?.reportedSupply === "off" &&
              context.breaker.automationDisabled &&
              room.controlMode === "simulated"
            ) {
              try {
                await adapter.setSupply(
                  room._id,
                  {
                    requestId: `restore-${context.breaker.lastRequestId}`,
                    action: "on",
                    reason: "occupancy_restore",
                  },
                  "worker",
                  now,
                  room,
                );
              } catch (err) {
                if (err.status !== 409) throw err;
              }
            }
            return;
          }
          const issueKey = `vacancy:${room._id}`;
          const incident = await models.Incident.findOneAndUpdate(
            { issueKey, active: true },
            {
              $setOnInsert: {
                roomId: room._id,
                type: "vacancy",
                title: `Review idle supply in ${room.code}`,
                state: "open",
                openedAt: now,
                policyVersion: room.policyVersion,
                firstResponderId: room.firstResponderId,
                secondResponderId: room.secondResponderId,
                backupResponderId: room.backupResponderId,
                evidence: {
                  observed: context.observed,
                  dataMode: context.observed.dataMode,
                },
                timeline: [
                  {
                    at: now,
                    event: "opened",
                    reason:
                      "Confirmed vacancy with unprotected energised room supply",
                  },
                ],
              },
            },
            { upsert: true, returnDocument: "after" },
          ).lean();
          await ensureIncidentJobs(models, incident, config);
        },
        now,
      );
    } catch (err) {
      if (err.code !== "ROOM_BUSY" && err.code !== 11000) throw err;
    }
  }
  // Recover work missing after a crash between incident persistence and job creation.
  for (const incident of await models.Incident.find({
    active: true,
    type: "vacancy",
  }).lean())
    await ensureIncidentJobs(models, incident, config);
  for (let count = 0; count < 50; count++) {
    const job = await models.Job.findOneAndUpdate(
      {
        dueAt: { $lte: now },
        $or: [
          { status: "pending" },
          { status: "leased", leaseUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          status: "leased",
          leaseOwner: workerId,
          leaseUntil: new Date(now.getTime() + 30000),
        },
        $inc: { attempts: 1 },
      },
      { sort: { dueAt: 1 }, returnDocument: "after" },
    ).lean();
    if (!job) break;
    try {
      await withRoomLock(
        models,
        job.roomId,
        async (room) => {
          const incident = await models.Incident.findById(
            job.incidentId,
          ).lean();
          if (!incident?.active) {
            await models.Job.updateOne(
              { _id: job._id, leaseOwner: workerId },
              { $set: { status: "cancelled" } },
            );
            return;
          }
          if (incident.snoozedUntil && incident.snoozedUntil > now) {
            await models.Job.updateOne(
              { _id: job._id, leaseOwner: workerId },
              { $set: { status: "pending", dueAt: incident.snoozedUntil } },
            );
            return;
          }
          const context = await roomContext(models, room, config, now);
          if (
            context.observed.state !== "vacant" ||
            context.protectedBy ||
            room.policyVersion !== job.policyVersion ||
            context.breaker?.reportedSupply === "off"
          ) {
            await cancelRoomWork(
              models,
              room._id,
              "Current evidence or policy invalidated queued work",
              now,
            );
            return;
          }
          if (job.stage !== "final") {
            await notify(models, incident, job.stage, now);
            await models.Incident.updateOne(
              { _id: incident._id, active: true },
              {
                $set: {
                  state: job.stage === "first" ? "notified_first" : "escalated",
                },
                $push: {
                  timeline: {
                    at: now,
                    event:
                      job.stage === "first"
                        ? "first_notification"
                        : "second_notification",
                    jobId: job._id,
                  },
                },
              },
            );
          } else {
            try {
              const command = await adapter.setSupply(
                room._id,
                {
                  requestId: `off-${incident._id}`,
                  action: "off",
                  reason: "vacancy_escalation",
                  incidentId: incident._id,
                  policyVersion: job.policyVersion,
                  expiresAt: new Date(now.getTime() + 30000).toISOString(),
                },
                "worker",
                now,
                room,
              );
              await models.Incident.updateOne(
                { _id: incident._id },
                {
                  $set: {
                    active: false,
                    state: "resolved",
                    resolution: {
                      method: "simulated",
                      commandId: command._id,
                      at: now,
                    },
                  },
                  $push: {
                    timeline: {
                      at: now,
                      event: "simulated_off",
                      verification: "simulated",
                    },
                  },
                },
              );
            } catch (err) {
              if (err.status !== 409) throw err;
              await models.Incident.updateOne(
                { _id: incident._id },
                {
                  $set: { state: "blocked" },
                  $push: {
                    timeline: {
                      at: now,
                      event: "manual_action_required",
                      reason: err.message,
                    },
                  },
                },
              );
              await notify(models, incident, "manual", now);
            }
          }
          await models.Job.updateOne(
            { _id: job._id, leaseOwner: workerId },
            { $set: { status: "completed" } },
          );
        },
        now,
      );
    } catch (err) {
      await models.Job.updateOne(
        { _id: job._id, leaseOwner: workerId },
        {
          $set: {
            status: job.attempts < 5 ? "pending" : "failed",
            dueAt: new Date(now.getTime() + 1000),
            errorCode: err.code ?? "WORK_FAILED",
          },
        },
      );
    }
  }
  for (const lease of await models.AccessLease.find({ endedAt: null }).lean()) {
    if (
      lease.expiresAt > now &&
      lease.expiresAt.getTime() - now.getTime() <= config.qrWarningMs &&
      !lease.warnedAt
    ) {
      const key = `lease:${lease._id}:warning:${lease.revision}`;
      await models.Notification.updateOne(
        { idempotencyKey: key },
        {
          $setOnInsert: {
            roomId: lease.roomId,
            stage: "lease_warning",
            recipientId: lease.requesterId,
            title: "Room access expires soon",
            message:
              "Extend an authorised lease or request staff assistance. Expiry does not prove vacancy.",
            state: "delivered",
            idempotencyKey: key,
          },
        },
        { upsert: true },
      );
      await models.AccessLease.updateOne(
        { _id: lease._id, revision: lease.revision },
        { $set: { warnedAt: now } },
      );
    }
    if (lease.expiresAt <= now && !lease.expiryHandledAt)
      await withRoomLock(
        models,
        lease.roomId,
        async () => {
          const current = await models.AccessLease.findById(lease._id).lean();
          if (
            current.expiresAt > now ||
            current.endedAt ||
            current.expiryHandledAt
          )
            return;
          const active = await models.AccessLease.exists({
            roomId: lease.roomId,
            endedAt: null,
            expiresAt: { $gt: now },
          });
          if (!active) {
            const incident = await models.Incident.findOneAndUpdate(
              { issueKey: `access_expired:${lease.roomId}`, active: true },
              {
                $setOnInsert: {
                  type: "access_expired",
                  roomId: lease.roomId,
                  title: "Access lease expired — staff confirmation required",
                  state: "open",
                  openedAt: now,
                  evidence: { leaseId: lease._id, occupancy: "not_inferred" },
                  timeline: [{ at: now, event: "lease_expired" }],
                },
              },
              { upsert: true, returnDocument: "after" },
            ).lean();
            await notify(models, incident, "first", now);
          }
          await models.AccessLease.updateOne(
            { _id: lease._id, revision: lease.revision },
            { $set: { expiryHandledAt: now } },
          );
          await audit(
            models,
            "worker",
            "lease.expired",
            lease._id,
            "Protection expired; no vacancy inferred and no blind cutoff",
          );
        },
        now,
      );
  }
  return { processedAt: now };
}
