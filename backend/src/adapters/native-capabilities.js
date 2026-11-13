import { createHash } from "node:crypto";
export const ENTITY_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const safeText = (value) => typeof value === "string" ? value.slice(0, 200) : null;
export function describeEntity(state, services = [], registry = {}, deviceRegistry = {}) {
  const entityId = state?.entity_id ?? "", domain = entityId.split(".")[0], attributes = state?.attributes ?? {};
  const available = services.find((entry) => entry.domain === domain)?.services ?? {};
  let action = null, reason = "This domain is read-only in the campus connector";
  const group = registry.platform === "group" || Array.isArray(attributes.entity_id);
  if (!ENTITY_ID.test(entityId) || group || ["group", "script", "scene", "button", "lock", "alarm_control_panel"].includes(domain)) reason = "Groups, indirect actions and unsafe targets are excluded";
  else if (/\b(master|breaker|emergency|fire|alarm|gateway|router)\b/.test(entityId.replaceAll("_", " "))) reason = "Possible room master or protected equipment; excluded from appliance control";
  else if (["light", "switch", "fan"].includes(domain) && available.turn_off) {
    // HA FanEntityFeature.TURN_OFF=16; absent support stays inventory-only.
    if (domain !== "fan" || (Number(attributes.supported_features) & 16) !== 0) {
      action = { domain, service: "turn_off", data: {} }; reason = "Candidate OFF action; model/load review and an explicit test are still required";
    } else reason = "Fan entity does not advertise the native TURN_OFF feature";
  } else if (domain === "climate" && Array.isArray(attributes.hvac_modes) && attributes.hvac_modes.includes("off") && available.set_hvac_mode) {
    action = { domain, service: "set_hvac_mode", data: { hvac_mode: "off" } };
    reason = "OFF HVAC mode advertised; idle does not mean OFF. Model review and explicit test required";
  }
  const connections = deviceRegistry.connections ?? [], identifiers = deviceRegistry.identifiers ?? [];
  const identity = [...connections, ...identifiers].filter((entry) => Array.isArray(entry) && entry.length === 2).map(([type, value]) => `${type}:${value}`).sort();
  return { entityId, domain, name: safeText(attributes.friendly_name) ?? entityId,
    physicalDeviceId: safeText(registry.device_id), registryId: safeText(registry.id),
    endpointFingerprint: identity.length ? createHash("sha256").update(identity.join("|")).digest("hex") : null,
    areaSuggestion: safeText(registry.area_id ?? deviceRegistry.area_id),
    capabilities: { canOff: !!action, action, reason, supportedFeatures: Number(attributes.supported_features) || 0,
      hvacModes: Array.isArray(attributes.hvac_modes) ? attributes.hvac_modes.filter((mode) => typeof mode === "string").slice(0, 20) : [],
      optimistic: attributes.assumed_state === true, evidence: "provider_metadata_not_physical_verification" },
    lastState: normaliseState(state) };
}
export function normaliseState(state, observedAt = new Date(), mode = "live") {
  const parsed = Date.parse(state?.last_updated ?? state?.last_changed);
  return { state: typeof state?.state === "string" ? state.state.slice(0, 100) : "unavailable",
    providerUpdatedAt: Number.isFinite(parsed) ? new Date(parsed) : new Date(0),
    observedAt: new Date(observedAt), source: mode === "live" ? "home_assistant" : "simulator", mode,
    optimistic: state?.attributes?.assumed_state === true };
}
export function newerObservation(previous, next) {
  if (!previous) return true;
  const before = +new Date(previous.providerUpdatedAt), after = +new Date(next.providerUpdatedAt);
  return after > before || (after === before && +new Date(next.observedAt) >= +new Date(previous.observedAt));
}
