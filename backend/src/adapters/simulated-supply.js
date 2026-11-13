export async function applySimulatedSupply(models, context, input, now) {
  const changed = context.breaker.reportedSupply !== input.action;
  await models.Breaker.updateOne({ _id: context.room.roomBreakerId }, { $set: {
    reportedSupply: input.action,
    automationDisabled: input.action === "off" && input.reason === "vacancy_escalation",
    ...(changed ? { lastChangedAt: now } : {}), lastRequestId: input.requestId,
  } });
  if (changed && input.action === "on") await models.Device.updateMany(
    { roomId: context.room._id, requiresNormalStopBeforeCutoff: true },
    { $set: { lastRestartAt: now, stopProcedureConfirmedAt: null } },
  );
}
