import { canRoom } from "../security/access.js";
import { journalHead } from "./journal.js";

export function visibleChange(event, user) {
  if (event.adminOnly && user.role !== "admin") return false;
  if (event.recipientId && user.role !== "admin" && event.recipientId !== user._id) return false;
  if (event.roomId && !canRoom(user, event.roomId)) return false;
  if (!event.roomId && ["incidents", "recommendations", "jobs"].includes(event.resource) && user.role !== "admin") return false;
  return true;
}
const permissions = user => JSON.stringify([user.role, [...user.permittedRoomIds].sort(), user.name]);
export async function syncSnapshot({ connection, models, workspaceDirectory }, user) {
  const realm = workspaceDirectory?.current();
  const db = realm?.connection ?? connection;
  const head = await journalHead(db);
  return { ...head, institutionId: user.institutionId ?? "legacy", user,
    serverTime: new Date().toISOString(), reconcile: "Refetch authorised page resources; event payloads are invalidations, never state replacements" };
}

// Every API process tails persisted changes, including writes from a different
// worker process/provider callback. No replica-set change stream is required.
export function startRealtime(io, { connection, models, workspaceDirectory, loadSession }) {
  let stopped = false, running = false;
  const initialise = socket => {
    socket.data.syncCursor = null;
    socket.data.permissionSignature = permissions(socket.data.user);
    socket.join(`institution:${socket.data.institutionId ?? "legacy"}`);
  };
  io.on("connection", initialise);
  async function validate(socket) {
    let identitySession;
    if (socket.data.syncSessionId) identitySession = await loadSession(socket.data.syncSessionId);
    else {
      await new Promise((resolve, reject) => socket.request.session.reload(error => error ? reject(error) : resolve()));
      identitySession = socket.request.session;
    }
    if (!identitySession?.userId || identitySession.userId !== socket.data.sessionUserId) throw new Error("AUTH_REQUIRED");
    let realm, user;
    if (workspaceDirectory) {
      if (identitySession.institutionId !== socket.data.institutionId) throw new Error("SESSION_CHANGED");
      realm = await workspaceDirectory.realm(socket.data.institutionId);
      user = await workspaceDirectory.user(realm, identitySession.userId);
    } else user = await models.User.findOne({ _id: identitySession.userId, active: true }).lean();
    if (!user || user.role === "admin" && !identitySession.adminVerified) throw new Error("AUTH_REQUIRED");
    const signature = permissions(user);
    if (signature !== socket.data.permissionSignature) {
      for (const room of socket.rooms) if (room.startsWith("room:")) socket.leave(room);
      socket.data.permissionSignature = signature;
      socket.emit("sync:reset", { reason: "permissions_changed", institutionId: socket.data.institutionId ?? "legacy" });
    }
    socket.data.user = user;
    return realm?.connection ?? connection;
  }
  async function poll() {
    if (running || stopped) return; running = true;
    try {
      for (const socket of io.sockets.sockets.values()) {
        let db;
        try { db = await validate(socket); }
        catch (error) {
          // A transient database failure must mark stale, not log the user out.
          if (["MongoServerSelectionError", "MongoNetworkError", "MongooseServerSelectionError"].includes(error.name)) { socket.emit("sync:degraded"); continue; }
          socket.emit("sync:revoked"); socket.disconnect(true); continue;
        }
        try {
          const head = await journalHead(db);
          if (socket.data.syncCursor === null) {
            socket.data.syncCursor = head.revision;
            socket.emit("sync:reset", { reason: "connected", institutionId: socket.data.institutionId ?? "legacy" });
          } else {
            const events = await db.collection("syncEvents").find({ revision: { $gt: socket.data.syncCursor } }).sort({ revision: 1 }).limit(250).toArray();
            for (const event of events) {
              if (visibleChange(event, socket.data.user)) {
                // Do not expose recipients, secrets or other-room metadata.
                const { _id, revision, resource, entityId, roomId, operation, phase, verification, at } = event;
                socket.emit("sync:change", { eventId: _id, revision, resource, entityId, roomId, operation, phase, verification, at, institutionId: socket.data.institutionId ?? "legacy" });
              }
              socket.data.syncCursor = event.revision;
            }
          }
          socket.emit("sync:heartbeat", { serverTime: new Date().toISOString(), degraded: head.degraded });
        } catch { socket.emit("sync:degraded"); }
      }
    } finally { running = false; }
  }
  const timer = setInterval(poll, 600); timer.unref();
  return async () => { stopped = true; clearInterval(timer); io.off("connection", initialise); while (running) await new Promise(resolve => setTimeout(resolve, 10)); };
}
