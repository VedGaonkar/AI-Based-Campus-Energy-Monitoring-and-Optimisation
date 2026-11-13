import { supplyEligibility } from "../domain/policies.js";
import { roomContext, audit } from "../services/context.js";
import { withRoomLock, fail } from "../security/access.js";
import { activePhoneDemo } from "../services/demo-session-state.js";
import { queueClassroomCommand } from "./demo-classroom.js";
import { applySimulatedSupply } from "./simulated-supply.js";

export function createRoomMaster(models, config) {
  if (config.deviceAdapter !== "simulator" || config.allowPhysicalControl)
    throw new Error(
      "Only the simulator is installed; physical adapters require commissioning",
    );
  return {
    async getCapabilities(roomBreakerId) {
      return {
        roomBreakerId,
        supplyControl: true,
        energyMetering: false,
        dataMode: "simulated",
        physicalControl: false,
      };
    },
    async getStatus(roomBreakerId) {
      return models.Breaker.findById(roomBreakerId).lean();
    },
    async getCommandResult(requestId) {
      return models.Command.findOne({ requestId }).lean();
    },
    async setSupply(roomId, input, actorId, now = new Date(), lockedRoom) {
      const operation = async (room) => {
        const existing = await models.Command.findOne({
          requestId: input.requestId,
        }).lean();
        if (existing) {
          if (
            existing.roomId !== roomId ||
            existing.action !== input.action ||
            existing.reason !== input.reason ||
            existing.actorId !== actorId
          )
            fail(
              409,
              "IDEMPOTENCY_CONFLICT",
              "Request ID belongs to a different command",
            );
          if (existing.result || existing.demoSessionId) return existing;
        }
        const expiresAt = new Date(input.expiresAt ?? now.getTime() + 30000);
        if (expiresAt.getTime() - now.getTime() > 60000)
          fail(
            400,
            "INVALID_DEADLINE",
            "Command deadline must be within one minute",
          );
        const context = await roomContext(models, room, config, now);
        const eligibility = supplyEligibility({
          ...context,
          action: input.action,
          reason: input.reason,
          now,
          config,
          policyVersion: input.policyVersion ?? room.policyVersion,
          expiresAt,
        });
        if (!eligibility.allowed)
          fail(409, "CONTROL_BLOCKED", eligibility.reason);
        const demo = await activePhoneDemo(models, room, config, now);
        if (room.demoSessionId && !demo) fail(409, "DEMO_ENDED", "Demo endpoint unavailable; no internal acknowledgement substituted");
        if (demo && await models.Command.exists({ roomId, demoSessionId: demo._id, _id: { $ne: existing?._id ?? "" }, state: { $in: ["pending", "sent"] }, expiresAt: { $gt: now } }))
          fail(409, "COMMAND_IN_FLIGHT", "Wait for the current virtual-classroom command outcome");
        const command =
          existing ??
          (
            await models.Command.create({
              ...input,
              expiresAt,
              roomId,
              roomBreakerId: room.roomBreakerId,
              policyVersion: room.policyVersion,
              actorId,
              issuedAt: now,
              state: "pending",
            })
          ).toObject();
        if (demo) return queueClassroomCommand(models, demo, command, now);
        // The ordinary internal simulator still applies its own durable state.
        await applySimulatedSupply(models, context, input, now);
        const result = {
          requestId: input.requestId,
          transportStatus: "acknowledged",
          reportedOutput: input.action,
          verification: "simulated",
          verifiedAt: now,
          dataMode: "simulated",
        };
        await models.Command.updateOne(
          { _id: command._id },
          { $set: { state: "completed", result } },
        );
        await audit(
          models,
          actorId,
          "supply.simulated",
          roomId,
          `${input.action}: ${input.reason}`,
        );
        return { ...command, state: "completed", result };
      };
      return lockedRoom
        ? operation(lockedRoom)
        : withRoomLock(models, roomId, operation, now);
    },
  };
}
