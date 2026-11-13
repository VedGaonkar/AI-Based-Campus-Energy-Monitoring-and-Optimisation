import { randomUUID } from "node:crypto";

// A durable invalidation feed works with standalone MongoDB as well as replica
// sets. It never stores documents, credentials, names, notification text or video.
const resources = {
  Room: "rooms", Floor: "floors", Settings: "institution", User: "permissions",
  Breaker: "room-master", Device: "inventory", Schedule: "schedules",
  AccessLease: "qr-leases", Override: "overrides", Incident: "incidents",
  Notification: "notifications", Command: "master-commands", NativeCommand: "native-commands",
  ConnectedDevice: "native-devices", DeviceConnection: "connections", Integration: "sources",
  Observation: "occupancy", Job: "jobs", DemoSession: "demo-sessions",
  MeterReading: "energy", Recommendation: "recommendations", Report: "reports", ImportBatch: "imports",
};
const ignored = new Set(["updatedAt", "commandLockOwner", "commandLockUntil", "frameOwner", "frameBusyUntil", "leaseOwner", "leaseUntil"]);
const fingerprint = row => JSON.stringify(row, (key, value) => ignored.has(key) ? undefined : value);
const initialisations = new WeakMap(), degraded = new WeakMap();
export async function initJournal(connection) {
  if (!initialisations.has(connection)) initialisations.set(connection, Promise.all([
    connection.collection("syncEvents").createIndex({ revision: 1 }, { unique: true }),
    connection.collection("syncEvents").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]).catch(error => { initialisations.delete(connection); throw error; }));
  await initialisations.get(connection);
}
export async function publishChange(connection, event) {
  try {
    await initJournal(connection);
    const counter = await connection.collection("syncCounters").findOneAndUpdate({ _id: "workspace" }, { $inc: { revision: 1 } }, { upsert: true, returnDocument: "after" });
    const now = new Date();
    await connection.collection("syncEvents").insertOne({ _id: randomUUID(), revision: counter.revision, at: now, expiresAt: new Date(+now + 86400000), ...event });
    degraded.set(connection, false);
  } catch {
    // The operational write already persisted. Do not pretend it was rolled
    // back or retry a command. Periodic snapshots repair any missing invalidation.
    degraded.set(connection, true);
    console.error(JSON.stringify({ code: "SYNC_JOURNAL_UNAVAILABLE" }));
  }
}
export async function journalHead(connection) {
  const latest = await connection.collection("syncEvents").findOne({}, { sort: { revision: -1 }, projection: { revision: 1 } });
  return { revision: latest?.revision ?? 0, degraded: degraded.get(connection) === true };
}
function descriptor(name, row) {
  const roomId = name === "Room" ? row._id : row.roomId;
  return {
    resource: resources[name], entityId: String(row._id), ...(roomId ? { roomId: String(roomId) } : {}),
    ...(name === "Notification" ? { recipientId: row.recipientId ?? "unassigned" } : {}),
    ...(name === "User" ? { userId: String(row._id), adminOnly: true } : {}),
    ...(["DeviceConnection", "DemoSession", "ImportBatch", "Floor", "Report"].includes(name) ? { adminOnly: true } : {}),
    ...(["Command", "NativeCommand"].includes(name) ? {
      phase: name === "Command" ? row.state : row.status,
      verification: name === "Command" ? row.result?.verification ?? "unverified" : row.verification ?? "unverified",
    } : {}),
  };
}
export function installChangeHooks(schema, { name, connection }) {
  if (!resources[name]) return;
  const emit = async (row, operation = "changed") => {
    if (row?._id) await publishChange(connection, { ...descriptor(name, row), operation });
  };
  schema.post("save", async function (doc) { await emit(doc.toObject()); });
  schema.post("insertMany", async function (docs) { for (const doc of docs) await emit(doc.toObject ? doc.toObject() : doc); });
  for (const operation of ["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace", "deleteOne", "deleteMany", "findOneAndDelete"]) {
    schema.pre(operation, async function () {
      const update = this.getUpdate?.();
      const keys = Object.keys(update?.$set ?? {}).concat(Object.keys(update?.$unset ?? {})).filter(key => !ignored.has(key));
      this.syncSkip = update && !keys.length && !update.$inc && !update.$push && !update.$setOnInsert;
      if (!this.syncSkip) this.syncBefore = await this.model.find(this.getFilter()).limit(1001).lean();
    });
    schema.post(operation, async function (result) {
      if (this.syncSkip || result?.matchedCount === 0 && !result.upsertedCount) return;
      const before = this.syncBefore ?? [];
      const ids = before.map(row => row._id);
      if (typeof this.getFilter()._id === "string") ids.push(this.getFilter()._id);
      if (result?.upsertedId) ids.push(String(result.upsertedId));
      if (result?._id) ids.push(result._id);
      const after = ids.length ? await this.model.find({ _id: { $in: ids } }).lean() : [];
      const old = new Map(before.map(row => [String(row._id), row]));
      for (const row of after) {
        const previous = old.get(String(row._id)); old.delete(String(row._id));
        if (fingerprint(previous) !== fingerprint(row)) {
          if (previous?.roomId && previous.roomId !== row.roomId) await emit(previous, "unmapped");
          await emit(row);
        }
      }
      for (const row of old.values()) await emit(row, "removed");
    });
  }
  // Bulk writes currently import building-meter history; they carry no room or
  // per-user metadata. Snapshot reconciliation reads the authorised data again.
  schema.post("bulkWrite", async function (result) {
    if (result.modifiedCount || result.upsertedCount || result.insertedCount || result.deletedCount)
      await publishChange(connection, { resource: resources[name], operation: "batch", adminOnly: !["MeterReading", "Recommendation"].includes(name) });
  });
}
