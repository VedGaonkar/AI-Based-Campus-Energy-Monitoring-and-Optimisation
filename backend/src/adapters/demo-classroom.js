import { supplyEligibility } from "../domain/policies.js";
import { roomContext, audit } from "../services/context.js";
import { withRoomLock, fail } from "../security/access.js";
import { activePhoneDemo, demoEndpointOnline } from "../services/demo-session-state.js";
import { applySimulatedSupply } from "./simulated-supply.js";

export async function queueClassroomCommand(models, session, command, now) {
  if (await models.Command.exists({ roomId: command.roomId, _id: { $ne: command._id }, demoSessionId: session._id, state: { $in: ["pending", "sent"] }, expiresAt: { $gt: now } }))
    fail(409, "COMMAND_IN_FLIGHT", "Wait for the current virtual-classroom command outcome");
  await models.Command.updateOne({ _id: command._id }, { $set: { demoSessionId: session._id }, $push: { timeline: { at: now, event: "created", dataMode: "simulated" } } });
  return { ...command, demoSessionId: session._id, state: "pending" };
}

export async function classroomCommands(models, config, grant, now = new Date()) {
  if (grant.role !== "classroom") return [];
  // Idle transport polling must not compete with camera/policy room locks.
  if (!await models.Command.exists({ demoSessionId: grant.sessionId, state: { $in: ["pending", "sent"] }, expiresAt: { $gt: now } })) return [];
  return withRoomLock(models, grant.roomId, async room => {
    const session = await activePhoneDemo(models, room, config, now);
    if (!session || session._id !== grant.sessionId) return [];
    const rows = await models.Command.find({ demoSessionId: session._id, state: { $in: ["pending", "sent"] }, expiresAt: { $gt: now } }).sort({ issuedAt: 1 }).limit(1).lean();
    const result = [];
    for (const command of rows) {
      const context = await roomContext(models, room, config, now);
      const eligibility = supplyEligibility({ ...context, action: command.action, reason: command.reason, now, config, policyVersion: command.policyVersion, expiresAt: command.expiresAt });
      if (command.reason === "occupancy_restore" && context.observed.state !== "occupied") { eligibility.allowed = false; eligibility.reason = "Fresh positive occupancy is required for queued occupancy restoration"; }
      if (!eligibility.allowed) {
        await models.Command.updateOne({ _id: command._id, state: { $in: ["pending", "sent"] } }, { $set: { state: command.state === "sent" ? "unverified" : "cancelled", result: { verification: "unknown", dataMode: "simulated", reason: eligibility.reason } }, $push: { timeline: { at: now, event: "delivery_blocked", reason: eligibility.reason } } });
        continue;
      }
      if (command.state === "pending") await models.Command.updateOne({ _id: command._id, state: "pending" }, { $set: { state: "sent", sentAt: now }, $push: { timeline: { at: now, event: "sent_to_virtual_classroom" } } });
      result.push({ _id: command._id, requestId: command.requestId, sessionId: session._id, roomId: room._id, action: command.action, expiresAt: command.expiresAt, policyVersion: command.policyVersion, dataMode: "simulated" });
    }
    return result;
  }, now);
}

export async function acknowledgeClassroom(models, config, grant, input, now = new Date()) {
  if (grant.role !== "classroom") fail(403, "DEMO_ROLE", "Only the paired classroom can acknowledge its command");
  return withRoomLock(models, grant.roomId, async room => {
    const session = await activePhoneDemo(models, room, config, now);
    if (!session || session._id !== grant.sessionId) fail(409, "DEMO_ENDED", "Demo session ended");
    const command = await models.Command.findOne({ _id: input.commandId, demoSessionId: session._id, roomId: room._id, action: input.action }).lean();
    if (!command) fail(404, "COMMAND_SCOPE", "Command is not assigned to this classroom");
    if (command.state === "completed") return command;
    if (command.state !== "sent" || command.expiresAt <= now) fail(409, "COMMAND_EXPIRED", "Command is expired, cancelled or was not delivered");
    const currentGrant = await models.DemoClient.findById(grant._id).lean();
    if (!demoEndpointOnline(currentGrant, now)) fail(409, "CLASSROOM_OFFLINE", "Classroom is no longer connected");
    const context = await roomContext(models, room, config, now);
    const eligibility = supplyEligibility({ ...context, action: command.action, reason: command.reason, now, config, policyVersion: command.policyVersion, expiresAt: command.expiresAt });
    if (command.reason === "occupancy_restore" && context.observed.state !== "occupied") fail(409, "CONTROL_BLOCKED", "Fresh positive occupancy is required for queued occupancy restoration");
    if (!eligibility.allowed) fail(409, "CONTROL_BLOCKED", eligibility.reason);
    await applySimulatedSupply(models, context, command, now);
    const result = { requestId: command.requestId, transportStatus: "acknowledged", reportedOutput: command.action,
      verification: "simulator_acknowledged", verifiedAt: now, dataMode: "simulated", evidenceSource: "virtual_classroom", physicalVerification: false };
    await models.Command.updateOne({ _id: command._id, state: "sent" }, { $set: { state: "completed", acknowledgedAt: now, result }, $push: { timeline: { at: now, event: "simulator_acknowledged", action: command.action } } });
    if (command.incidentId) await models.Incident.updateOne({ _id: command.incidentId, active: true }, {
      $set: { active: false, state: "resolved", resolution: { method: "simulator_acknowledged", commandId: command._id, at: now } },
      $push: { timeline: { at: now, event: "simulator_acknowledged_off", commandId: command._id } },
    });
    await audit(models, `demo-classroom:${grant._id}`, "supply.simulator_acknowledged", room._id, `${command.action}; no physical verification`);
    return { ...command, state: "completed", result };
  }, now);
}

export async function reconcileClassroomCommands(models, now = new Date()) {
  const rows = await models.Command.find({ demoSessionId: { $exists: true }, state: { $in: ["pending", "sent"] }, expiresAt: { $lte: now } }).lean();
  for (const row of rows) {
    const state = row.state === "sent" ? "unverified" : "expired";
    await models.Command.updateOne({ _id: row._id, state: row.state }, { $set: { state, result: { verification: "unknown", dataMode: "simulated", reason: "Virtual classroom did not acknowledge before expiry" } }, $push: { timeline: { at: now, event: state } } });
    await models.DemoSession.updateOne({ _id: row.demoSessionId, active: true }, { $set: { lastError: "Command unverified/expired. Reset this demo session before another automatic attempt." } });
    if (row.incidentId) await models.Incident.updateOne({ _id: row.incidentId, active: true }, { $set: { active: false, state: "action_unverified" }, $push: { timeline: { at: now, event: state, commandId: row._id } } });
  }
}
