import { supplyEligibility } from "../domain/policies.js";
import { roomContext, audit } from "../services/context.js";
import { withRoomLock, fail } from "../security/access.js";

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
          if (existing.result) return existing;
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
        // Simulated state is durable. Replaying the same explicit command cannot toggle it.
        const changed = context.breaker.reportedSupply !== input.action;
        await models.Breaker.updateOne(
          { _id: room.roomBreakerId },
          {
            $set: {
              reportedSupply: input.action,
              automationDisabled:
                input.action === "off" && input.reason === "vacancy_escalation",
              ...(changed ? { lastChangedAt: now } : {}),
              lastRequestId: input.requestId,
            },
          },
        );
        if (changed && input.action === "on")
          await models.Device.updateMany(
            { roomId, requiresNormalStopBeforeCutoff: true },
            { $set: { lastRestartAt: now, stopProcedureConfirmedAt: null } },
          );
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
