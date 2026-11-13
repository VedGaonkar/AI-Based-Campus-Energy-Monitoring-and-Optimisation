import { createServer } from "node:http";
import { WebSocketServer } from "ws";
export async function startHomeAssistantMock() {
  const token = "mock-ha-authorised-token-not-a-real-credential", requests = [], options = { confirm: true, responseStatus: null, staleSnapshot: false, largeState: false, hang: false };
  let state = { entity_id: "light.protocol_test", state: "on", attributes: { friendly_name: "Protocol test light" }, last_updated: new Date().toISOString() };
  const registry = [{ id: "registry-test-light", entity_id: state.entity_id, device_id: "physical-test-light", platform: "demo" }];
  const services = [{ domain: "light", services: { turn_off: { target: { entity: [{ domain: "light" }] } } } }];
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: req.url, ...(body ? { body: JSON.parse(body) } : {}) });
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(JSON.stringify({ message: "Unauthorized" })); return; }
    if (options.hang) return;
    if (options.responseStatus) { res.writeHead(options.responseStatus, { Location: "http://169.254.169.254/latest/meta-data" }).end("{}"); return; }
    if (req.method === "GET") {
      if (req.url === "/api/") res.end(JSON.stringify({ message: "API running." }));
      else if (req.url === "/api/config") res.end(JSON.stringify({ version: "2026.11.1", location_name: "PRIVATE_LOCATION_MUST_NOT_LEAK" }));
      else if (req.url === "/api/states") res.end(options.largeState ? JSON.stringify([{ ...state, excessive: "x".repeat(2 * 1024 * 1024) }]) : JSON.stringify([state]));
      else if (req.url === `/api/states/${state.entity_id}`) res.end(JSON.stringify(state));
      else if (req.url === "/api/services") res.end(JSON.stringify(services));
      else res.writeHead(404).end("{}");
    } else if (req.method === "POST" && req.url === "/api/services/light/turn_off") {
      if (JSON.parse(body).entity_id !== state.entity_id) { res.writeHead(400).end("{}"); return; }
      if (options.confirm) setState("off");
      res.end("[]");
    } else res.writeHead(404).end("{}");
  });
  const wss = new WebSocketServer({ server, path: "/api/websocket", maxPayload: 1024 * 1024 });
  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "auth_required", ha_version: "2026.11.1" }));
    let authenticated = false, subscription;
    socket.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "auth") {
        authenticated = msg.access_token === token;
        socket.send(JSON.stringify({ type: authenticated ? "auth_ok" : "auth_invalid", ha_version: "2026.11.1" }));
        if (!authenticated) socket.close(); return;
      }
      if (!authenticated) { socket.close(); return; }
      if (msg.type === "subscribe_events") { subscription = msg.id; socket.subscriptionId = msg.id; }
      let result = null;
      if (msg.type === "get_states") {
        result = [{ ...state }];
        if (options.staleSnapshot) {
          const older = { ...state, state: "on", last_updated: new Date(Date.now() - 10000).toISOString() };
          socket.send(JSON.stringify({ id: subscription, type: "event", event: { event_type: "state_changed", data: { entity_id: state.entity_id, new_state: { ...state, state: "off" } } } }));
          result = [older];
        }
      } else if (msg.type === "config/entity_registry/list") result = registry;
      else if (msg.type === "config/device_registry/list") result = [{ id: "physical-test-light", identifiers: [["mock_hardware", "stable-serial-1"]], area_id: "area-suggestion" }];
      socket.send(JSON.stringify(msg.type === "ping" ? { id: msg.id, type: "pong" } : { id: msg.id, type: "result", success: true, result }));
    });
  });
  function setState(value) {
    state = { ...state, state: value, last_updated: new Date().toISOString() };
    for (const socket of wss.clients) if (socket.subscriptionId) socket.send(JSON.stringify({ id: socket.subscriptionId, type: "event", event: { event_type: "state_changed", data: { entity_id: state.entity_id, new_state: state } } }));
  }
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { token, requests, options, registry, services, get state() { return state; }, setState,
    origin: `http://127.0.0.1:${server.address().port}`,
    dropSockets() { for (const socket of wss.clients) socket.terminate(); },
    async close() { for (const socket of wss.clients) socket.terminate(); await new Promise((resolve) => wss.close(resolve)); await new Promise((resolve) => server.close(resolve)); },
  };
}
