import { describeEntity, normaliseState } from "./native-capabilities.js";
import { ProviderError } from "./native-security.js";
const fixtures = [
  ["light.demo_lecture", "Lecture light", {}, "confirm"],
  ["fan.demo_lab", "Laboratory fan", { supported_features: 16 }, "confirm"],
  ["switch.demo_socket", "Reviewed ordinary load", {}, "confirm"],
  ["climate.demo_ac", "Native HVAC OFF", { hvac_modes: ["cool", "off"], hvac_action: "idle" }, "confirm"],
  ["sensor.demo_power", "Read-only power sensor", {}, "confirm"],
  ["switch.room_master", "Protected room master", {}, "confirm"],
  ["light.demo_group", "Excluded group", { entity_id: ["light.demo_lecture"] }, "confirm"],
  ["light.demo_unavailable", "Unavailable light", {}, "unavailable"],
  ["light.demo_unconfirmed", "Accepted without OFF feedback", {}, "unverified"],
];
const services = ["light", "fan", "switch"].map((domain) => ({ domain, services: { turn_off: {} } })).concat({ domain: "climate", services: { set_hvac_mode: {} } });
export function createNativeSimulator(connection, models, { onState = async () => {} } = {}) {
  const haState = (row) => ({ entity_id: row.entityId, state: row.state, attributes: row.attributes, last_updated: row.providerUpdatedAt?.toISOString() });
  const initialise = async () => {
    for (const [entityId, name, attributes, outcome] of fixtures)
      await models.SimulatedEntity.updateOne({ connectionId: connection._id, entityId }, { $setOnInsert: {
        connectionId: connection._id, entityId, attributes: { friendly_name: name, ...attributes },
        state: outcome === "unavailable" ? "unavailable" : entityId.startsWith("climate.") ? "cool" : "on", providerUpdatedAt: new Date(), outcome,
      } }, { upsert: true });
  };
  let seeded;
  const seed = () => seeded ??= initialise().catch((error) => { seeded = undefined; throw error; });
  async function row(entityId) {
    await seed(); const result = await models.SimulatedEntity.findOne({ connectionId: connection._id, entityId }).lean();
    if (!result) throw new ProviderError("IDENTITY_CHANGED"); return result;
  }
  async function describeCapabilities(entityId) {
    const item = await row(entityId), result = describeEntity(haState(item), services, { id: `sim-${entityId}`, device_id: `simulated-${entityId}` });
    result.lastState.mode = "simulated"; result.lastState.source = "simulator"; return result;
  }
  return {
    async testConnection() { await seed(); return { health: "online", mode: "simulated", version: "campus-native-simulator-v1" }; },
    async discoverEntities() { await seed(); return Promise.all(fixtures.map(([entityId]) => describeCapabilities(entityId))); },
    describeCapabilities,
    async readState(entityId) { return normaliseState(haState(await row(entityId)), new Date(), "simulated"); },
    async requestOff(entityId, context) {
      const item = await row(entityId);
      if (!(await describeCapabilities(entityId)).capabilities.canOff) throw new ProviderError("UNSUPPORTED");
      if (item.outcome === "unavailable") throw new ProviderError("UNAVAILABLE");
      if (item.outcome === "transport_error") throw new ProviderError("TRANSPORT");
      await context.beforeDispatch?.();
      if (item.outcome === "confirm") {
        await models.SimulatedEntity.updateOne({ _id: item._id }, { $set: { state: "off", providerUpdatedAt: new Date() } });
        await onState(entityId, normaliseState(haState(await row(entityId)), new Date(), "simulated"));
      }
      return { accepted: true, mode: "simulated", at: new Date(), physicalVerification: false };
    },
    async subscribeStateChanges() {}, async disconnect() {},
  };
}
