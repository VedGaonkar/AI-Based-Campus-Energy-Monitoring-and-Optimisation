import { io } from "socket.io-client";
import { REALTIME_ORIGIN } from "./origins.js";

function liveSocket(request) {
  return io(REALTIME_ORIGIN || undefined, {
    withCredentials: !REALTIME_ORIGIN, autoConnect: false, closeOnBeforeunload: true,
    ...(REALTIME_ORIGIN ? {
      // The HTTP proxy owns the cookie; direct cross-site sockets use its ticket.
      // Socket.IO calls auth again on each reconnect, so expired tickets renew.
      auth: callback => { request("/sync/ticket").then(callback).catch(() => callback({})); },
    } : {}),
  });
}

// Events invalidate data; only authorised HTTP snapshots replace page state.
// One controller per authenticated App, independent of navigation and tabs.
export function startLiveSync({ request, invalidate, identity, status, revoked, expectedInstitutionId, socket = liveSocket(request), environment = window }) {
  let stopped = false, revision = -1, heartbeat = 0, pending = false, again = false, timer, controller;
  const institutionId = () => socket.institutionId;
  const visible = () => environment.document.visibilityState !== "hidden";
  async function reconcile() {
    if (stopped || !visible()) return;
    if (pending) { again = true; return; }
    pending = true; status("reconciling"); controller = new AbortController();
    try {
      const snapshot = await request("/sync/snapshot", { signal: controller.signal });
      if (stopped || controller.signal.aborted) return;
      if (expectedInstitutionId && snapshot.institutionId !== expectedInstitutionId) { revoked(); return; }
      if (snapshot.revision < revision) { again = true; return; }
      socket.institutionId = snapshot.institutionId;
      revision = Math.max(revision, snapshot.revision);
      identity(snapshot.user); invalidate();
      status(!socket.connected ? "disconnected" : snapshot.degraded || Date.now() - heartbeat > 5000 ? "stale" : "current");
    } catch (error) {
      if (stopped || error.name === "AbortError") return;
      if ([401, 403].includes(error.status)) revoked(); else status("stale");
    } finally { pending = false; if (again && !stopped) { again = false; schedule(); } }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(reconcile, 120); }
  const handlers = {
    connect: () => { heartbeat = Date.now(); reconcile(); },
    disconnect: () => { controller?.abort(); status("disconnected"); },
    connect_error: () => status("disconnected"),
    "sync:reset": event => { if (!institutionId() || event.institutionId === institutionId()) schedule(); },
    "sync:change": event => {
      if (event.institutionId !== institutionId() || !Number.isSafeInteger(event.revision) || event.revision <= revision) return;
      revision = event.revision; schedule();
    },
    "sync:heartbeat": event => { heartbeat = Date.now(); if (event.degraded) status("stale"); },
    "sync:degraded": () => status("stale"),
    "sync:revoked": () => revoked(),
  };
  for (const [name, handler] of Object.entries(handlers)) socket.on(name, handler);
  const resume = () => { if (visible()) { if (!socket.connected) socket.connect(); reconcile(); } else { controller?.abort(); status("background"); } };
  const pagehide = () => { controller?.abort(); socket.disconnect(); status("background"); };
  environment.addEventListener("online", resume); environment.addEventListener("focus", resume);
  environment.addEventListener("pagehide", pagehide); environment.addEventListener("pageshow", resume);
  environment.document.addEventListener("visibilitychange", resume);
  const watch = setInterval(() => { if (visible() && (!socket.connected || Date.now() - heartbeat > 5000)) status("stale"); }, 1000);
  // Repair missed delivery, journal crash windows and time-derived protections.
  const repair = setInterval(reconcile, 15000);
  status("connecting"); socket.connect();
  return () => {
    stopped = true; controller?.abort(); clearTimeout(timer); clearInterval(watch); clearInterval(repair);
    for (const [name, handler] of Object.entries(handlers)) socket.off(name, handler);
    socket.disconnect(); environment.removeEventListener("online", resume); environment.removeEventListener("focus", resume); environment.document.removeEventListener("visibilitychange", resume);
    environment.removeEventListener("pagehide", pagehide); environment.removeEventListener("pageshow", resume);
  };
}
