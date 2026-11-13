import WebSocket from "ws";
import { gatewayRequest, pinnedOptions, ProviderError, providerError } from "./native-security.js";
import { describeEntity, normaliseState, ENTITY_ID } from "./native-capabilities.js";

// Server-only client: HA 2026.11.1 REST and WebSocket contracts. Tokens never
// reach the frontend; ws gives us explicit socket lookup pins and size limits.
export function createHomeAssistantProvider(connection, config, token, { onState = async () => {}, onHealth = async () => {} } = {}) {
  let socket, stopped = false, reconnectTimer, heartbeat, attempts = 0, sequence = 0, authenticated = false;
  const pending = new Map();
  const request = (path, body) => gatewayRequest(connection, config, token, path, body);
  const command = (type, fields = {}) => new Promise((resolve, reject) => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !authenticated) return reject(new ProviderError("UNAVAILABLE"));
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new ProviderError("TIMEOUT")); }, 5000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, type, ...fields }));
  });
  async function registries() {
    try {
      const [entities, devices] = await Promise.all([command("config/entity_registry/list"), command("config/device_registry/list")]);
      return { entities: Array.isArray(entities) ? entities : [], devices: Array.isArray(devices) ? devices : [] };
    } catch { return { entities: [], devices: [] }; }
  }
  async function discoverEntities() {
    const [states, services, registry] = await Promise.all([request("/api/states"), request("/api/services"), registries()]);
    if (!Array.isArray(states) || !Array.isArray(services)) throw new ProviderError("TRANSPORT");
    return states.slice(0, 5000).map((state) => {
      const entry = registry.entities.find((item) => item.entity_id === state.entity_id) ?? {};
      return describeEntity(state, services, entry, registry.devices.find((item) => item.id === entry.device_id) ?? {});
    });
  }
  async function describeCapabilities(entityId) {
    if (!ENTITY_ID.test(entityId)) throw new ProviderError("UNSUPPORTED");
    const [state, services, registry] = await Promise.all([request(`/api/states/${entityId}`), request("/api/services"), registries()]);
    const entry = registry.entities.find((item) => item.entity_id === entityId) ?? {};
    return describeEntity(state, services, entry, registry.devices.find((item) => item.id === entry.device_id) ?? {});
  }
  const handle = (operation) => { Promise.resolve(operation).catch(() => {}); };
  async function connect() {
    if (stopped) return;
    let options;
    try { options = await pinnedOptions(connection, config); }
    catch (error) { handle(onHealth("degraded", providerError(error).code)); scheduleReconnect(); return; }
    if (stopped) return;
    const url = new URL("/api/websocket", connection.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url, { ...options, followRedirects: false, maxPayload: 2 * 1024 * 1024, handshakeTimeout: 5000, perMessageDeflate: false });
    const authTimeout = setTimeout(() => socket?.terminate(), 6000);
    socket.on("message", (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { socket.terminate(); return; }
      if (message.type === "auth_required") socket.send(JSON.stringify({ type: "auth", access_token: token }));
      else if (message.type === "auth_invalid") {
        // Invalid credentials require replacement, not endless retry.
        stopped = true; clearTimeout(authTimeout); handle(onHealth("authentication_failed", "AUTHENTICATION")); socket.terminate();
      } else if (message.type === "auth_ok") {
        authenticated = true; clearTimeout(authTimeout);
        (async () => {
          // Subscribe before requesting a snapshot. Consumers compare provider
          // timestamps so an older snapshot cannot overwrite a newer event.
          await command("subscribe_events", { event_type: "state_changed" });
          const snapshot = await command("get_states");
          for (const state of snapshot ?? []) await onState(state.entity_id, normaliseState(state), state === null);
          attempts = 0; await onHealth("online");
          heartbeat = setInterval(() => command("ping").catch(() => socket?.terminate()), 15000);
          heartbeat.unref();
        })().catch((error) => { handle(onHealth("degraded", providerError(error).code)); socket?.terminate(); });
      } else if (message.type === "result" || message.type === "pong") {
        if (message.type === "pong") handle(onHealth("online"));
        const deferred = pending.get(message.id);
        if (!deferred) return;
        clearTimeout(deferred.timer); pending.delete(message.id);
        message.success === false ? deferred.reject(new ProviderError(message.error?.code === "unauthorized" ? "AUTHORIZATION" : "UNSUPPORTED")) : deferred.resolve(message.result);
      } else if (message.type === "event" && message.event?.event_type === "state_changed") {
        const { entity_id: entityId, new_state: state } = message.event.data ?? {};
        if (typeof entityId === "string") handle(onState(entityId, normaliseState(state), state === null));
      }
    });
    socket.on("error", () => { handle(onHealth("degraded", "TRANSPORT")); });
    socket.on("close", () => {
      authenticated = false; clearTimeout(authTimeout); clearInterval(heartbeat);
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new ProviderError("UNAVAILABLE")); }
      pending.clear();
      if (!stopped) { handle(onHealth("degraded", "UNAVAILABLE")); scheduleReconnect(); }
    });
  }
  function scheduleReconnect() {
    if (stopped || attempts >= 8) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => connect().catch(() => {}), Math.min(30000, 500 * 2 ** attempts++));
    reconnectTimer.unref();
  }
  return {
    async testConnection() {
      await request("/api/"); const info = await request("/api/config");
      return { health: "online", mode: "live", version: typeof info.version === "string" ? info.version : "unknown", identityEvidence: "configured_origin" };
    },
    discoverEntities, describeCapabilities,
    async readState(entityId) { if (!ENTITY_ID.test(entityId)) throw new ProviderError("UNSUPPORTED"); return normaliseState(await request(`/api/states/${entityId}`)); },
    async requestOff(entityId, context) {
      const description = await describeCapabilities(entityId), action = description.capabilities.action;
      if (!action || description.capabilities.optimistic) throw new ProviderError("UNSUPPORTED");
      // The service owns the allowlist and rechecks policy immediately before
      // this adapter call. No arbitrary URL/service/body enters this interface.
      await context.beforeDispatch?.();
      await request(`/api/services/${action.domain}/${action.service}`, { entity_id: entityId, ...action.data });
      return { accepted: true, at: new Date(), mode: "live", physicalVerification: false };
    },
    async subscribeStateChanges() { stopped = false; await connect(); },
    async disconnect() {
      stopped = true; clearTimeout(reconnectTimer); clearInterval(heartbeat);
      socket?.terminate();
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new ProviderError("UNAVAILABLE")); }
      pending.clear();
    },
  };
}
