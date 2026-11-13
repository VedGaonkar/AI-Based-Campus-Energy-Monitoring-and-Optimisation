import { BACKEND_ORIGIN } from "./config.js";
export const $ = selector => document.querySelector(selector);
export const text = (selector, value) => { const element = $(selector); if (element) element.textContent = value ?? "Unknown"; };
const app = document.body.dataset.app;
const storageKey = `campus-demo-${app}`;
let pairing;
try { pairing = JSON.parse(sessionStorage.getItem(storageKey) ?? "null"); } catch {}
let socket, heartbeat, lastState;
export const credential = () => pairing;
export async function request(path, body, { signal } = {}) {
  const response = await fetch(`${BACKEND_ORIGIN}/api/v1/demo-phone${path}`, {
    method: body === undefined ? "GET" : "POST", credentials: "omit", cache: "no-store", signal: signal ?? AbortSignal.timeout(12000),
    headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(pairing ? { Authorization: `Bearer ${pairing.token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/pair") unpair();
    throw new Error(result.error?.message ?? `Request failed (${response.status})`);
  }
  return result.data;
}
export function error(message = "") { text("#error", message); $("#error").hidden = !message; }
function acceptState(state) {
  lastState = state;
  text("#room", `${state.room.code} · ${state.room.name}`);
  text("#session", `Session ${state.session._id.slice(0, 8)} · ${state.session.visionMode.replaceAll("_", " ")}`);
  document.dispatchEvent(new CustomEvent("demo:state", { detail: state }));
}
export function unpair() {
  pairing = null; sessionStorage.removeItem(storageKey); clearInterval(heartbeat); socket?.disconnect();
  $("#pair-panel").hidden = false; $("#paired-panel").hidden = true; text("#connection", "Unpaired");
  document.dispatchEvent(new Event("demo:unpaired"));
}
async function connect() {
  if (!pairing || Date.now() >= new Date(pairing.expiresAt)) return unpair();
  if (app === "camera" && pairing.role !== "camera") { unpair(); throw new Error("Use the camera-role pairing code on Phone A"); }
  if (app === "classroom" && pairing.role === "camera") { unpair(); throw new Error("Use the classroom-role pairing code on Phone B"); }
  $("#pair-panel").hidden = true; $("#paired-panel").hidden = false;
  acceptState(await request("/state"));
  socket?.disconnect();
  socket = window.io(`${BACKEND_ORIGIN || location.origin}/demo-phone`, { auth: { token: pairing.token }, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });
  socket.on("connect", () => { text("#connection", "Connected · simulated only"); error(""); });
  socket.on("disconnect", () => text("#connection", "Disconnected · state unverified"));
  socket.on("connect_error", () => text("#connection", "Reconnecting · no verified delivery"));
  socket.on("demo:state", acceptState);
  socket.on("demo:command", command => document.dispatchEvent(new CustomEvent("demo:command", { detail: command })));
  clearInterval(heartbeat);
  heartbeat = setInterval(async () => {
    if (!pairing) return;
    if (socket.connected) socket.emit("demo:heartbeat");
    else {
      try {
        acceptState(await request("/state"));
        if (pairing?.role === "classroom") for (const command of await request("/commands")) document.dispatchEvent(new CustomEvent("demo:command", { detail: command }));
      } catch (failure) { error(failure.message); }
    }
  }, 2000);
  document.dispatchEvent(new CustomEvent("demo:paired", { detail: pairing }));
}
$("#pair-form").addEventListener("submit", async event => {
  event.preventDefault(); error("");
  const button = $("#pair-form button"); button.disabled = true;
  try {
    pairing = await request("/pair", { code: $("#pair-code").value.trim() });
    sessionStorage.setItem(storageKey, JSON.stringify(pairing)); $("#pair-code").value = "";
    await connect();
  } catch (failure) { error(failure.message); } finally { button.disabled = false; }
});
$("#pair-form button").disabled = false;
$("#unpair").addEventListener("click", () => { request("/offline", {}).catch(() => {}); unpair(); });
const code = new URLSearchParams(location.hash.slice(1)).get("pair");
if (code) { $("#pair-code").value = code; history.replaceState(null, "", location.pathname); }
// Let each independent app attach its event handlers before restoring a pairing.
export async function ready() { if (pairing) await connect().catch(failure => error(failure.message)); }
export const state = () => lastState;
