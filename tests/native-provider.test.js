import test from "node:test";
import assert from "node:assert/strict";
import { createHomeAssistantProvider } from "../backend/src/adapters/home-assistant.js";
import { validateDestination, sealToken, openToken, gatewayRequest } from "../backend/src/adapters/native-security.js";
import { describeEntity, newerObservation, normaliseState } from "../backend/src/adapters/native-capabilities.js";
import { startHomeAssistantMock } from "./helpers/home-assistant-mock.js";
async function waitFor(operation) { for (let index = 0; index < 100; index++) { if (await operation()) return; await new Promise((resolve) => setTimeout(resolve, 20)); } throw new Error("Protocol mock did not become ready"); }
const settings = (origin) => ({ haAllowedOrigins: [origin], haAllowHttp: true, haAllowLoopback: true });
const binding = (origin) => ({ baseUrl: origin, pinnedAddresses: ["127.0.0.1"] });

test("gateway destinations reject metadata, URL credentials/paths, wrong origins and DNS rebinding", async () => {
  for (const url of ["http://169.254.169.254:8123", "http://user:password@192.168.1.2:8123", "http://192.168.1.2:8123/arbitrary", "http://192.168.1.2:8124", "http://[::ffff:169.254.169.254]:8123"])
    await assert.rejects(() => validateDestination(url, settings("http://192.168.1.2:8123")));
  const config = settings("https://ha.example.test"); config.haAllowHttp = false;
  const resolution = await validateDestination("https://ha.example.test", config, undefined, async () => [{ address: "192.168.1.20" }]);
  assert.deepEqual(resolution.addresses, ["192.168.1.20"]);
  await assert.rejects(() => validateDestination("https://ha.example.test", config, resolution.addresses, async () => [{ address: "192.168.1.21" }]), { code: "DESTINATION" });
});
test("token encryption is authenticated, bound to connection identity and not readable as plaintext", () => {
  const token = "private-bearer-token", secret = "server-only-key-material", encrypted = sealToken(token, secret, "connection-one");
  assert.ok(!JSON.stringify(encrypted).includes(token)); assert.equal(openToken(encrypted, secret, "connection-one"), token);
  assert.throws(() => openToken(encrypted, secret, "connection-two")); assert.throws(() => openToken(encrypted, "wrong-key", "connection-one"));
});
test("capabilities exclude groups/masters/scripts, require fan OFF support and climate off mode", () => {
  const services = ["light", "fan", "switch"].map((domain) => ({ domain, services: { turn_off: {} } })).concat({ domain: "climate", services: { set_hvac_mode: {} } });
  const state = (entity_id, attributes = {}) => ({ entity_id, state: "on", attributes, last_updated: new Date().toISOString() });
  assert.equal(describeEntity(state("fan.lab", { supported_features: 16 }), services).capabilities.canOff, true);
  assert.equal(describeEntity(state("fan.lab", { supported_features: 1 }), services).capabilities.canOff, false);
  for (const entity of [state("light.group", { entity_id: ["light.lab"] }), state("switch.room_master"), state("script.anything"), state("climate.lab", { hvac_modes: ["cool"], hvac_action: "idle" })]) assert.equal(describeEntity(entity, services).capabilities.canOff, false);
  assert.equal(describeEntity(state("climate.lab", { hvac_modes: ["cool", "off"] }), services).capabilities.action.service, "set_hvac_mode");
});
test("HA REST/WS mock authenticates, discovers registry identity and sends only exact OFF service calls", async () => {
  const mock = await startHomeAssistantMock(); let health;
  const client = createHomeAssistantProvider(binding(mock.origin), settings(mock.origin), mock.token, { onHealth: (value) => { health = value; } });
  try {
    await client.subscribeStateChanges(); await waitFor(() => health === "online");
    const connection = await client.testConnection(); assert.equal(connection.version, "2026.11.1"); assert.ok(!JSON.stringify(connection).includes("PRIVATE_LOCATION"));
    const entities = await client.discoverEntities(); assert.equal(entities[0].physicalDeviceId, "physical-test-light"); assert.equal(entities[0].registryId, "registry-test-light");
    await client.requestOff("light.protocol_test", {});
    assert.equal((await client.readState("light.protocol_test")).state, "off");
    assert.deepEqual(mock.requests.filter((r) => r.method === "POST"), [{ method: "POST", path: "/api/services/light/turn_off", body: { entity_id: "light.protocol_test" } }]);
    await assert.rejects(() => gatewayRequest(binding(mock.origin), settings(mock.origin), mock.token, "/api/states/light.protocol_test", { state: "off" }), { code: "UNSUPPORTED" });
  } finally { await client.disconnect(); await mock.close(); }
});
test("HA authentication errors and redirects are typed/redacted and never followed", async () => {
  const mock = await startHomeAssistantMock();
  const client = createHomeAssistantProvider(binding(mock.origin), settings(mock.origin), "wrong-secret", {});
  try {
    await assert.rejects(() => client.testConnection(), (error) => error.code === "AUTHENTICATION" && !error.message.includes("wrong-secret"));
    mock.options.responseStatus = 302;
    await assert.rejects(() => gatewayRequest(binding(mock.origin), settings(mock.origin), mock.token, "/api/"), { code: "UNAVAILABLE" });
    assert.ok(mock.requests.every((r) => r.path.startsWith("/api/")));
    mock.options.responseStatus = 429;
    await assert.rejects(() => gatewayRequest(binding(mock.origin), settings(mock.origin), mock.token, "/api/"), { code: "RATE_LIMITED" });
  } finally { await client.disconnect(); await mock.close(); }
});
test("newer WS event survives an older reconnect snapshot; reconnect refreshes state", async () => {
  const mock = await startHomeAssistantMock(); mock.options.staleSnapshot = true; let latest, online = 0;
  const client = createHomeAssistantProvider(binding(mock.origin), settings(mock.origin), mock.token, {
    onState: (_id, state) => { if (newerObservation(latest, state)) latest = state; },
    onHealth: (status) => { if (status === "online") online++; },
  });
  try {
    await client.subscribeStateChanges(); await waitFor(() => online > 0); assert.equal(latest.state, "off");
    mock.options.staleSnapshot = false; mock.setState("off"); mock.dropSockets();
    await waitFor(() => online > 1); assert.equal(latest.state, "off");
    const older = normaliseState({ state: "on", last_updated: new Date(0).toISOString() }); assert.equal(newerObservation(latest, older), false);
  } finally { await client.disconnect(); await mock.close(); }
});
test("gateway requests enforce response limits and an overall timeout", async () => {
  const mock = await startHomeAssistantMock();
  try {
    mock.options.largeState = true;
    await assert.rejects(() => gatewayRequest(binding(mock.origin), settings(mock.origin), mock.token, "/api/states"), { code: "RESPONSE_LIMIT" });
    mock.options.largeState = false; mock.options.hang = true;
    await assert.rejects(() => gatewayRequest(binding(mock.origin), settings(mock.origin), mock.token, "/api/", undefined, 30), { code: "TIMEOUT" });
  } finally { await mock.close(); }
});
test("sub-millisecond provider ordering prevents an older snapshot overwriting a newer event", () => {
  const stamp = new Date(Date.now() - 1000).toISOString().slice(0, 19);
  const latest = normaliseState({ state: "off", last_updated: `${stamp}.123900Z` }, new Date());
  const olderSnapshot = normaliseState({ state: "on", last_updated: `${stamp}.123100Z` }, new Date(Date.now() + 100));
  assert.equal(+latest.providerUpdatedAt, +olderSnapshot.providerUpdatedAt);
  assert.equal(newerObservation(latest, olderSnapshot), false);
});
