import { createHash, randomUUID } from "node:crypto";
import { createHomeAssistantProvider } from "../adapters/home-assistant.js";
import { createNativeSimulator } from "../adapters/native-simulator.js";
import { sealToken, openToken, validateDestination, ProviderError, providerError } from "../adapters/native-security.js";
import { newerObservation } from "../adapters/native-capabilities.js";
import { roomContext, audit, cancelRoomWork } from "./context.js";
import { fail, withRoomLock } from "../security/access.js";

const services = new WeakMap();
const pendingStates = ["requested", "dispatched", "accepted"];
const successful = ["confirmed", "already_off"];
const terminal = [...successful, "failed", "unverified", "cancelled", "expired"];
const at = (value) => +new Date(value ?? 0);
const record = (value) => { if (!value) fail(404, "NOT_FOUND", "Record not found"); return value; };
export function publicConnection(row) {
  const { tokenCipher, pinnedAddresses, ...safe } = row;
  return safe;
}
export function getConnectedDeviceService(models, config) {
  let configs = services.get(models);
  if (!configs) { configs = new WeakMap(); services.set(models, configs); }
  if (!configs.has(config)) configs.set(config, createService(models, config));
  return configs.get(config);
}
function createService(models, config) {
  const clients = new Map();
  let closed = false;
  const connection = async (id, secret = false) => record(await models.DeviceConnection.findById(id).select(secret ? "+tokenCipher" : "").lean());
  const device = async (id) => record(await models.ConnectedDevice.findById(id).lean());
  async function transition(commandId, status, fields = {}, from = pendingStates) {
    await models.NativeCommand.updateOne({ _id: commandId, status: { $in: from } }, {
      $set: { status, ...fields }, $push: { timeline: { at: new Date(), status, ...(fields.errorCode ? { code: fields.errorCode } : {}) } },
    });
  }
  async function cancelTargets(query, reason) {
    const targets = await models.ConnectedDevice.find(query).select("_id").lean(), ids = targets.map((d) => d._id);
    await models.Job.updateMany({ kind: "native_off", targetId: { $in: ids }, status: { $in: ["pending", "leased"] } }, { $set: { status: "cancelled", errorCode: reason } });
    await models.NativeCommand.updateMany({ deviceId: { $in: ids }, status: { $in: pendingStates } }, {
      $set: { status: "cancelled", errorCode: reason }, $push: { timeline: { at: new Date(), status: "cancelled", code: reason } },
    });
  }
  async function observeState(connectionId, entityId, next, deleted = false) {
    const current = await models.ConnectedDevice.findOne({ connectionId, entityId }).lean();
    if (!current) return;
    const conn = await models.DeviceConnection.findById(connectionId).lean();
    if (!conn?.enabled || !current.enabled) return;
    next.mode = conn.mode; next.source = conn.mode === "simulated" ? "simulator" : "home_assistant";
    if (deleted) {
      await models.ConnectedDevice.updateOne({ _id: current._id }, { $set: { identityStatus: "missing", manualOffAllowed: false, automaticOffAllowed: false, suspendReason: "Entity removed/renamed; reconcile the exact binding" } });
      await cancelTargets({ _id: current._id }, "IDENTITY_CHANGED"); return;
    }
    if (!newerObservation(current.lastState, next)) return;
    // The conditional write protects against concurrent API/worker snapshots.
    const ordered = current.lastState ? { $or: [
      { "lastState.providerUpdatedAt": { $lt: next.providerUpdatedAt } },
      { "lastState.providerUpdatedAt": next.providerUpdatedAt, "lastState.observedAt": { $lte: next.observedAt } },
    ] } : { lastState: { $exists: false } };
    const updated = await models.ConnectedDevice.updateOne({ _id: current._id, ...ordered }, { $set: { lastState: next } });
    if (!updated.matchedCount) return;
    if (current.completedVacancyOff && !["off", "unknown", "unavailable"].includes(next.state)) {
      await models.ConnectedDevice.updateOne({ _id: current._id }, { $set: { automaticOffAllowed: false, suspendReason: "Provider/manual state changed after automatic OFF. Review before re-enabling automation." } });
      await cancelTargets({ _id: current._id }, "EXTERNAL_CHANGE");
    }
    if (next.state !== "off" || next.optimistic) return;
    const room = await models.Room.findById(current.roomId).lean();
    const breaker = room && await models.Breaker.findById(room.roomBreakerId).lean();
    if (!breaker || breaker.reportedSupply !== "on" || breaker.faultTripped || breaker.maintenanceLocked || breaker.manuallyIsolated) return;
    for (const cmd of await models.NativeCommand.find({ deviceId: current._id, status: { $in: ["dispatched", "accepted", "unverified"] } }).lean()) {
      if (cmd.mode !== next.mode || at(next.observedAt) < at(cmd.dispatchedAt) || at(next.providerUpdatedAt) < at(cmd.evidence?.before?.providerUpdatedAt)) continue;
      await transition(cmd._id, "confirmed", { verification: conn.mode === "simulated" ? "simulated" : "provider_reported_off", evidence: { before: cmd.evidence?.before, after: next, label: "Reported OFF; not independently measured", late: cmd.status === "unverified" } }, ["dispatched", "accepted", "unverified"]);
      if (cmd.reason === "manual_test") await models.ConnectedDevice.updateOne({ _id: current._id, revision: cmd.deviceRevision }, { $set: {
        lastTest: { commandId: cmd._id, status: "confirmed", mode: conn.mode, at: new Date(), deviceRevision: cmd.deviceRevision, connectionRevision: cmd.connectionRevision },
        verification: conn.mode === "simulated" ? "simulated" : "provider_reported_off",
      } });
      if (cmd.reason === "vacancy_escalation") await models.ConnectedDevice.updateOne({ _id: current._id }, { $set: { completedVacancyOff: true } });
    }
  }
  async function provider(id) {
    const conn = await connection(id, true);
    if (!conn.enabled) fail(409, "CONNECTION_DISABLED", "Connection is disconnected");
    const existing = clients.get(id);
    if (existing?.revision === conn.revision) return { client: existing.client, conn };
    if (existing) await existing.client.disconnect();
    const callbacks = {
      onState: (entityId, state, deleted) => observeState(id, entityId, state, deleted),
      onHealth: async (health, errorCode) => {
        if (closed) return;
        await models.DeviceConnection.updateOne({ _id: id, revision: conn.revision, enabled: true }, { $set: {
          health, socketHealth: health, lastError: errorCode ?? null, ...(health === "online" ? { lastSeenAt: new Date() } : {}),
        } });
      },
    };
    const client = conn.provider === "simulator" ? createNativeSimulator(conn, models, callbacks)
      : createHomeAssistantProvider(conn, config, openToken(conn.tokenCipher, config.sessionSecret, id), callbacks);
    clients.set(id, { client, revision: conn.revision });
    await client.subscribeStateChanges();
    return { client, conn };
  }
  async function suspendChangedIdentity(target, candidate) {
    if ((target.registryId && candidate.registryId !== target.registryId) || (target.physicalDeviceId && candidate.physicalDeviceId !== target.physicalDeviceId) || (target.endpointFingerprint && target.endpointFingerprint !== candidate.endpointFingerprint)) {
      await models.ConnectedDevice.updateOne({ _id: target._id }, { $set: { identityStatus: "changed", manualOffAllowed: false, automaticOffAllowed: false, suspendReason: "Provider registry identity changed. Explicitly reconcile the binding." } });
      await cancelTargets({ _id: target._id }, "IDENTITY_CHANGED"); throw new ProviderError("IDENTITY_CHANGED");
    }
  }
  async function refreshTarget(target) {
    const { client } = await provider(target.connectionId);
    let description;
    try { description = await client.describeCapabilities(target.entityId); }
    catch (error) { if (error.code === "IDENTITY_CHANGED") await observeState(target.connectionId, target.entityId, {}, true); throw error; }
    await suspendChangedIdentity(target, description);
    await models.ConnectedDevice.updateOne({ _id: target._id }, { $set: { capabilities: description.capabilities } });
    await observeState(target.connectionId, target.entityId, description.lastState);
    return description;
  }
  async function eligibility(target, conn, room, reason, now, command) {
    if (!target.enabled || !conn.enabled || !target.manualOffAllowed || !target.identityReviewed || !target.capabilityReviewed || target.classification !== "ordinary" || target.identityStatus !== "reviewed") fail(409, "DEVICE_BLOCKED", "Review the exact entity, ordinary load and native OFF capability before control");
    if (!target.capabilities?.canOff || target.capabilities.optimistic) fail(409, "UNSUPPORTED", "Native OFF or non-optimistic state feedback is unavailable");
    if (conn.mode === "live" && (config.demoMode || !config.allowNativeControl || !conn.liveControlEnabled)) fail(409, "LIVE_DISABLED", "Live native control is disabled by server or connection policy; simulation cannot authorise it");
    if (conn.mode === "simulated" && !config.demoMode) fail(409, "SIMULATION_DISABLED", "Simulation requires demo mode");
    if (conn.health !== "online" || (conn.mode === "live" && (conn.socketHealth !== "online" || Date.now() - at(conn.lastSeenAt) > 45000))) fail(409, "PROVIDER_UNAVAILABLE", "Gateway is degraded, disconnected or stale");
    if (reason === "vacancy_escalation" && (!target.automaticOffAllowed || room.nativeOffMode !== conn.mode || !validTest(target, conn))) fail(409, "AUTOMATION_DISABLED", "Automatic OFF requires room permission and a successful explicit test in the same mode/configuration");
    const context = await roomContext(models, room, config, now);
    if (context.observed.state !== "vacant" || context.protectedBy) fail(409, "ROOM_PROTECTED", context.protectedBy ? `Room protected by ${context.protectedBy}` : "Fresh confirmed vacancy is required; unknown occupancy is protected");
    if (conn.mode === "live" && context.observed.dataMode !== "live") fail(409, "REPLAY_ISOLATED", "Simulated occupancy cannot authorise live OFF");
    const breaker = context.breaker;
    if (!breaker || breaker.reportedSupply !== "on" || breaker.faultTripped || breaker.maintenanceLocked || breaker.manuallyIsolated || !breaker.interlocksKnown || !room.independentInfrastructure) fail(409, "ROOM_INTERLOCK", "Room supply or independent control infrastructure is not eligible");
    if (await models.Breaker.exists({ $or: [{ _id: target.entityId }, { nativeDeviceId: target.entityId }, ...(target.physicalDeviceId ? [{ nativeDeviceId: target.physicalDeviceId }] : [])] })) fail(409, "MASTER_EXCLUDED", "The room master cannot be controlled through the appliance path");
    if (target.inventoryId) {
      const load = await models.Device.findById(target.inventoryId).lean();
      if (!load || load.roomId !== room._id || load.essential || load.essentialStandbyRequirement) fail(409, "PROTECTED_LOAD", "Inventory mapping is invalid or the load is protected");
    }
    if (command && (at(command.expiresAt) <= Date.now() || command.policyVersion !== room.policyVersion || command.deviceRevision !== target.revision || command.connectionRevision !== conn.revision)) fail(409, "STALE_COMMAND", "Command expired or its policy/binding changed");
    return context;
  }
  function validTest(target, conn) {
    return target.lastTest?.status === "confirmed" && target.lastTest.mode === conn.mode && target.lastTest.deviceRevision === target.revision && target.lastTest.connectionRevision === conn.revision;
  }
  async function enqueue(target, actorId, reason, now = new Date(), incident, expiresAt = new Date(now.getTime() + 30000), requestId = randomUUID()) {
    const existing = await models.NativeCommand.findOne({ requestId }).lean();
    if (existing) {
      if (existing.deviceId !== target._id || existing.actorId !== actorId || existing.reason !== reason) fail(409, "IDEMPOTENCY_CONFLICT", "Request ID belongs to another command");
      return existing;
    }
    const conn = await connection(target.connectionId), room = record(await models.Room.findById(target.roomId).lean());
    const command = await models.NativeCommand.create({ requestId, deviceId: target._id, connectionId: conn._id, roomId: room._id, entityId: target.entityId,
      mode: conn.mode, actorId, reason, incidentId: incident?._id, issuedAt: now, expiresAt, policyVersion: room.policyVersion,
      deviceRevision: target.revision, connectionRevision: conn.revision, status: "requested", timeline: [{ at: now, status: "requested" }],
    });
    await ensureJob(command.toObject());
    await audit(models, actorId, "native.off_requested", target._id, conn.mode);
    return command.toObject();
  }
  async function ensureJob(command) {
    await models.Job.updateOne({ _id: `native-${command._id}` }, { $setOnInsert: { kind: "native_off", targetId: command.deviceId, commandId: command._id,
      roomId: command.roomId, incidentId: command.incidentId, dueAt: command.issuedAt, expiresAt: command.expiresAt,
      policyVersion: command.policyVersion, deviceRevision: command.deviceRevision, connectionRevision: command.connectionRevision, stage: "native_off", status: "pending" } }, { upsert: true });
  }
  async function execute(command, room, lockOwner, now) {
    if (terminal.includes(command.status)) return;
    if (at(command.expiresAt) <= Math.max(Date.now(), at(now))) { await transition(command._id, "expired", { errorCode: "EXPIRED" }); return; }
    const target = await device(command.deviceId), conn = await connection(command.connectionId);
    if (command.incidentId && !(await models.Incident.exists({ _id: command.incidentId, active: true }))) { await transition(command._id, "cancelled", { errorCode: "INCIDENT_CANCELLED" }); return; }
    try {
      await eligibility(target, conn, room, command.reason, now, command);
      const { client } = await provider(conn._id);
      const description = await refreshTarget(target), before = description.lastState;
      if (["unknown", "unavailable"].includes(before.state)) throw new ProviderError("UNAVAILABLE");
      if (Date.now() - at(before.observedAt) > 30000) fail(409, "STATE_STALE", "Fresh reported state is required");
      if (before.state === "off" && command.status === "requested") {
        await transition(command._id, "already_off", { verification: conn.mode === "simulated" ? "simulated" : "provider_reported_off", evidence: { after: before, label: "Already OFF before request; no action dispatched" } });
        return;
      }
      // A recovered dispatched/accepted command is read/reconciled, never sent again.
      if (command.status !== "requested") {
        await observeState(conn._id, target.entityId, await client.readState(target.entityId));
        await transition(command._id, "unverified", { errorCode: "RESTART_UNCERTAINTY" }); return;
      }
      await transition(command._id, "dispatched", { dispatchedAt: new Date(), evidence: { before } }, ["requested"]);
      await client.requestOff(target.entityId, { beforeDispatch: async () => {
        const latest = await device(target._id), latestConnection = await connection(conn._id);
        const currentRoom = record(await models.Room.findOne({ _id: room._id, commandLockOwner: lockOwner, commandLockUntil: { $gt: new Date() } }).lean());
        await eligibility(latest, latestConnection, currentRoom, command.reason, new Date(), command);
        const currentCommand = await models.NativeCommand.findById(command._id).lean();
        if (!pendingStates.includes(currentCommand.status)) fail(409, "COMMAND_CANCELLED", "Command was cancelled before dispatch");
        if (command.incidentId && !(await models.Incident.exists({ _id: command.incidentId, active: true }))) fail(409, "INCIDENT_CANCELLED", "Incident no longer permits this command");
      } });
      await transition(command._id, "accepted", { acceptedAt: new Date() }, ["dispatched"]);
      // A new authenticated read is evidence, unlike the service-call HTTP 200.
      await observeState(conn._id, target.entityId, await client.readState(target.entityId));
      await transition(command._id, "unverified", { errorCode: "NO_OFF_CONFIRMATION" }, ["dispatched", "accepted"]);
    } catch (error) {
      const code = error.code ?? "TRANSPORT";
      const latest = await models.NativeCommand.findById(command._id).lean();
      const uncertain = ["dispatched", "accepted"].includes(latest.status) && ["TIMEOUT", "TRANSPORT", "UNAVAILABLE"].includes(code);
      await transition(command._id, uncertain ? "unverified" : "failed", { errorCode: code });
      await audit(models, command.actorId, "native.off_not_confirmed", target._id, code);
    }
  }
  async function reconcileIncidents(now) {
    for (const incident of await models.Incident.find({ active: true, "evidence.nativeOffPlanned": true, "evidence.nativeOutcomeRecorded": { $ne: true } }).lean()) {
      const commands = await models.NativeCommand.find({ incidentId: incident._id }).lean();
      if (!commands.length || commands.some((cmd) => pendingStates.includes(cmd.status))) continue;
      const ok = commands.every((cmd) => successful.includes(cmd.status));
      await models.Incident.updateOne({ _id: incident._id, active: true }, { $set: {
        active: !ok, state: ok ? "resolved" : "blocked", "evidence.nativeOutcomeRecorded": true,
        ...(ok ? { resolution: { method: commands.every((cmd) => cmd.mode === "simulated") ? "native_simulated" : "provider_reported_off", at: now, commandIds: commands.map((cmd) => cmd._id) } } : {}),
      }, $push: { timeline: { at: now, event: ok ? "native_off_reported" : "native_off_unverified_no_breaker_fallback", verification: ok ? "reported_not_metered" : "unknown" } } });
    }
  }
  return {
    observeState, refreshTarget, provider,
    async createConnection(input, actorId) {
      const id = randomUUID(), simulated = input.provider === "simulator";
      if (simulated && !config.demoMode) fail(409, "SIMULATION_DISABLED", "Simulator is available only in demonstration mode");
      let destination;
      if (!simulated) {
        if (!input.token || !input.baseUrl) fail(400, "CREDENTIAL_REQUIRED", "A gateway URL and authorised token are required");
        destination = await validateDestination(input.baseUrl, config);
      }
      const row = await models.DeviceConnection.create({ _id: id, name: input.name, provider: input.provider,
        mode: simulated ? "simulated" : "live", instanceKey: simulated ? `simulator:${id}` : createHash("sha256").update(destination.origin).digest("hex"),
        baseUrl: destination?.origin, pinnedAddresses: destination?.addresses,
        ...(simulated ? {} : { tokenCipher: sealToken(input.token, config.sessionSecret, id) }), createdBy: actorId, updatedBy: actorId,
      });
      await audit(models, actorId, "native.connection_created", id, row.mode);
      return publicConnection(row.toObject());
    },
    async updateConnection(id, input, actorId) {
      const current = await connection(id);
      const fields = { updatedBy: actorId, liveControlEnabled: false, health: "not_tested", socketHealth: "disconnected" };
      if (input.name !== undefined) fields.name = input.name;
      if (input.enabled !== undefined) fields.enabled = input.enabled;
      if (current.provider === "home_assistant" && input.baseUrl) {
        const destination = await validateDestination(input.baseUrl, config);
        fields.baseUrl = destination.origin; fields.pinnedAddresses = destination.addresses;
        fields.instanceKey = createHash("sha256").update(destination.origin).digest("hex");
      }
      if (input.token && current.provider === "home_assistant") fields.tokenCipher = sealToken(input.token, config.sessionSecret, id);
      await models.DeviceConnection.updateOne({ _id: id }, { $set: fields, $inc: { revision: 1 } });
      await cancelTargets({ connectionId: id }, "CONNECTION_CHANGED");
      await models.ConnectedDevice.updateMany({ connectionId: id }, { $set: { automaticOffAllowed: false, manualOffAllowed: false, lastTest: null, suspendReason: "Connection changed; review and test again" } });
      if (clients.has(id)) { await clients.get(id).client.disconnect(); clients.delete(id); }
      await audit(models, actorId, "native.connection_updated", id, input.enabled === false ? "Disconnected; pending native work cancelled" : "Permissions reset");
      return publicConnection(await connection(id));
    },
    async testConnection(id) {
      try {
        const { client } = await provider(id), result = await client.testConnection();
        await models.DeviceConnection.updateOne({ _id: id }, { $set: { health: "online", lastTestedAt: new Date(), lastSeenAt: new Date(), version: result.version, lastError: null } });
        return result;
      } catch (error) {
        const safe = providerError(error);
        await models.DeviceConnection.updateOne({ _id: id }, { $set: { health: "degraded", lastError: safe.code } });
        throw safe;
      }
    },
    async discover(id) {
      const { client, conn } = await provider(id), candidates = await client.discoverEntities();
      for (const target of await models.ConnectedDevice.find({ connectionId: id, enabled: true }).lean()) {
        const candidate = candidates.find((item) => item.entityId === target.entityId);
        if (!candidate) await observeState(id, target.entityId, {}, true);
        else { try { await suspendChangedIdentity(target, candidate); await observeState(id, target.entityId, candidate.lastState); } catch {} }
      }
      return candidates.map((item) => ({ ...item, mode: conn.mode }));
    },
    async register(input, actorId) {
      const room = record(await models.Room.findById(input.roomId).lean()), conn = await connection(input.connectionId);
      const { client } = await provider(conn._id), candidate = await client.describeCapabilities(input.entityId);
      if (await models.ConnectedDevice.exists({ connectionId: conn._id, entityId: input.entityId })) fail(409, "DUPLICATE_ENTITY", "This exact entity is already registered; open its existing binding");
      if (candidate.endpointFingerprint && await models.ConnectedDevice.exists({ endpointFingerprint: candidate.endpointFingerprint, enabled: true })) fail(409, "ENDPOINT_RECONCILIATION", "This physical endpoint already has a binding. Reconcile its entities/routes before registration");
      if (candidate.physicalDeviceId && await models.ConnectedDevice.exists({ instanceKey: conn.instanceKey, physicalDeviceId: candidate.physicalDeviceId, enabled: true })) fail(409, "ENDPOINT_RECONCILIATION", "This HA physical device already has a campus actuator binding");
      if (input.inventoryId) {
        const inventory = record(await models.Device.findById(input.inventoryId).lean());
        if (inventory.roomId !== room._id) fail(409, "INVENTORY_SCOPE", "Inventory belongs to another room");
      }
      const created = await models.ConnectedDevice.create({ connectionId: conn._id, instanceKey: conn.instanceKey, entityId: candidate.entityId,
        physicalDeviceId: candidate.physicalDeviceId, registryId: candidate.registryId, endpointFingerprint: candidate.endpointFingerprint,
        areaSuggestion: candidate.areaSuggestion, roomId: room._id, ...(input.inventoryId ? { inventoryId: input.inventoryId } : {}),
        name: input.name ?? candidate.name, domain: candidate.domain, capabilities: candidate.capabilities,
        lastState: { ...candidate.lastState, mode: conn.mode, source: conn.mode === "simulated" ? "simulator" : "home_assistant" }, createdBy: actorId, updatedBy: actorId,
      });
      await audit(models, actorId, "native.entity_registered", created._id, candidate.capabilities.canOff ? "Unreviewed OFF candidate" : "Inventory/read-only");
      return created.toObject();
    },
    async review(id, input, actorId) {
      const target = await device(id);
      return withRoomLock(models, target.roomId, async () => {
        const candidate = await refreshTarget(target);
        if (input.manualOffAllowed && (!candidate.capabilities.canOff || candidate.capabilities.optimistic || input.classification !== "ordinary" || !input.identityReviewed || !input.capabilityReviewed)) fail(409, "REVIEW_INCOMPLETE", "Approve only the exact ordinary load with a supported, non-optimistic OFF action");
        await models.ConnectedDevice.updateOne({ _id: id }, { $set: { ...input, automaticOffAllowed: false, lastTest: null, identityStatus: input.identityReviewed ? "reviewed" : "unreviewed", suspendReason: null, reviewedBy: actorId, reviewedAt: new Date(), updatedBy: actorId }, $inc: { revision: 1 } });
        await cancelTargets({ _id: id }, "REVIEW_CHANGED"); await cancelRoomWork(models, target.roomId, "Native device review changed");
        await audit(models, actorId, "native.entity_reviewed", id);
        return device(id);
      });
    },
    async setAutomatic(id, enabled, actorId) {
      const target = await device(id), conn = await connection(target.connectionId);
      if (enabled && (!validTest(target, conn) || !target.manualOffAllowed || target.identityStatus !== "reviewed" || !conn.enabled || (conn.mode === "live" && (config.demoMode || !config.allowNativeControl || !conn.liveControlEnabled)))) fail(409, "TEST_REQUIRED", "Enable only after a confirmed explicit OFF test in the current mode/configuration");
      await models.ConnectedDevice.updateOne({ _id: id }, { $set: { automaticOffAllowed: enabled, completedVacancyOff: false, suspendReason: null, automationEnabledBy: actorId, automationEnabledAt: new Date() } });
      if (!enabled) await cancelTargets({ _id: id }, "AUTOMATION_DISABLED");
      await audit(models, actorId, "native.automation_permission", id, enabled ? "Enabled" : "Disabled"); return device(id);
    },
    async setLivePermission(id, enabled, actorId) {
      const conn = await connection(id);
      if (enabled && (conn.mode !== "live" || config.demoMode || !config.allowNativeControl || conn.health !== "online" || conn.socketHealth !== "online" || !conn.lastTestedAt)) fail(409, "LIVE_DISABLED", "Live OFF requires server enablement outside demo mode and a healthy authenticated gateway");
      await models.DeviceConnection.updateOne({ _id: id }, { $set: { liveControlEnabled: enabled, updatedBy: actorId } });
      if (!enabled) { await cancelTargets({ connectionId: id }, "LIVE_DISABLED"); await models.ConnectedDevice.updateMany({ connectionId: id }, { $set: { automaticOffAllowed: false } }); }
      await audit(models, actorId, "native.live_permission", id, enabled ? "Enabled" : "Disabled"); return publicConnection(await connection(id));
    },
    async unregister(id, actorId) {
      const target = await device(id);
      await models.ConnectedDevice.updateOne({ _id: id }, { $set: { enabled: false, automaticOffAllowed: false, manualOffAllowed: false, identityStatus: "unregistered" }, $inc: { revision: 1 } });
      await cancelTargets({ _id: id }, "UNREGISTERED"); await audit(models, actorId, "native.entity_unregistered", id); return { unregistered: true, roomId: target.roomId };
    },
    async requestOff(id, requestId, actorId) {
      const target = await device(id);
      return withRoomLock(models, target.roomId, async (room) => {
        await eligibility(target, await connection(target.connectionId), room, "manual_test", new Date());
        return enqueue(target, actorId, "manual_test", new Date(), null, undefined, requestId);
      });
    },
    async nativeRoomDemand(room) {
      if (!room.nativeOffMode || room.nativeOffMode === "alert_only") return null;
      const targets = await models.ConnectedDevice.find({ roomId: room._id, enabled: true, automaticOffAllowed: true }).lean();
      // Even unavailable/unverified devices retain an incident/manual task.
      return targets.some((target) => target.lastState?.state !== "off");
    },
    async planIncident(incident, finalJob, room, now) {
      const existing = await models.NativeCommand.countDocuments({ incidentId: incident._id });
      if ((!room.nativeOffMode || room.nativeOffMode === "alert_only") && !existing) return false;
      const targets = await models.ConnectedDevice.find({ roomId: room._id, enabled: true, automaticOffAllowed: true }).lean();
      const deadline = finalJob.expiresAt ?? new Date(at(finalJob.dueAt) + 30000);
      for (const target of targets) await enqueue(target, "worker", "vacancy_escalation", now, incident, deadline, `native-${incident._id}-${target._id}`);
      await models.Incident.updateOne({ _id: incident._id }, { $set: { state: targets.length || existing ? "native_pending" : "blocked", "evidence.nativeOffPlanned": true }, $push: { timeline: { at: now, event: "native_off_selected_no_breaker_fallback" } } });
      return true;
    },
    async sync() {
      for (const conn of await models.DeviceConnection.find({ enabled: true }).lean()) {
        try {
          const { client } = await provider(conn._id);
          if (conn.provider === "simulator") {
            if (conn.health !== "online") continue;
            for (const target of await models.ConnectedDevice.find({ connectionId: conn._id, enabled: true }).lean()) await observeState(conn._id, target.entityId, await client.readState(target.entityId));
          }
        } catch (error) { await models.DeviceConnection.updateOne({ _id: conn._id }, { $set: { health: "degraded", lastError: providerError(error).code } }); }
      }
    },
    async processJobs(now = new Date(), workerId = randomUUID()) {
      for (const command of await models.NativeCommand.find({ status: { $in: pendingStates } }).lean()) await ensureJob(command);
      // Persist cancellation even if cancelRoomWork cancelled a leased job while
      // a worker was down. Dispatched work stays uncertain, never gets replayed.
      for (const job of await models.Job.find({ kind: "native_off", status: "cancelled" }).select("commandId").lean()) await transition(job.commandId, "cancelled", { errorCode: "POLICY_CANCELLED" });
      for (let index = 0; index < 20; index++) {
        const job = await models.Job.findOneAndUpdate({ kind: "native_off", dueAt: { $lte: now }, $or: [{ status: "pending" }, { status: "leased", leaseUntil: { $lte: now } }] },
          { $set: { status: "leased", leaseOwner: workerId, leaseUntil: new Date(at(now) + 30000) }, $inc: { attempts: 1 } }, { sort: { dueAt: 1 }, returnDocument: "after" }).lean();
        if (!job) break;
        try {
          const cmd = record(await models.NativeCommand.findById(job.commandId).lean());
          await withRoomLock(models, job.roomId, (room, owner) => execute(cmd, room, owner, now), now);
          await models.Job.updateOne({ _id: job._id, leaseOwner: workerId }, { $set: { status: "completed" } });
        } catch (error) {
          if (error.code === "ROOM_BUSY" && at(job.expiresAt) > at(now)) await models.Job.updateOne({ _id: job._id, leaseOwner: workerId }, { $set: { status: "pending", dueAt: new Date(at(now) + 250) } });
          else { await transition(job.commandId, at(job.expiresAt) <= at(now) ? "expired" : "failed", { errorCode: error.code ?? "NATIVE_JOB_FAILED" }); await models.Job.updateOne({ _id: job._id, leaseOwner: workerId }, { $set: { status: "failed" } }); }
        }
      }
      await reconcileIncidents(now);
    },
    async simulateState(connectionId, entityId, input) {
      const conn = await connection(connectionId);
      if (!config.demoMode || conn.provider !== "simulator") fail(409, "SIMULATION_ONLY", "Only the isolated simulator accepts scenario states");
      record(await models.SimulatedEntity.findOne({ connectionId, entityId }).lean());
      await models.SimulatedEntity.updateOne({ connectionId, entityId }, { $set: { ...input, providerUpdatedAt: new Date() } });
      const { client } = await provider(connectionId); await observeState(connectionId, entityId, await client.readState(entityId));
      return { simulated: true };
    },
    async close() { closed = true; await Promise.all([...clients.values()].map(({ client }) => client.disconnect())); clients.clear(); },
  };
}
