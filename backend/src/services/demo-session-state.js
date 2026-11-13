export async function activePhoneDemo(models, room, config, now = new Date()) {
  if (!config.demoMode || config.allowPhysicalControl || config.deviceAdapter !== "simulator" || !room.demoSessionId) return null;
  return models.DemoSession.findOne({ _id: room.demoSessionId, roomId: room._id, active: true, expiresAt: { $gt: now } }).lean();
}
export function demoEndpointOnline(client, now = new Date()) {
  return !!(client?.pairedAt && client.expiresAt > now && !client.offlineAt && now - client.lastSeenAt < 6000);
}
export function effectiveEquipment(scene, supply) {
  return Object.fromEntries(["light", "fan", "ac", "display"].map(key => [key, supply === "on" && !!scene?.localSwitches?.[key]]));
}
