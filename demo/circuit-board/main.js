import { $, text, error, request, ready, credential, state as currentState } from "../shared/phone.js";
const names = ["light", "fan", "ac", "display", "occupied", "empty_on", "empty_off"];
const labels = ["Light", "Fan", "AC", "Display / projector", "Occupied classroom · equipment ON", "Empty classroom · equipment ON", "Empty classroom · equipment OFF"];
let snapshot, applying = false;
const inFlight = new Set(), acknowledged = new Set();
for (const key of ["light", "fan", "ac", "display"]) {
  const row = document.createElement("div"); row.className = "toggle-row";
  const label = document.createElement("label"), check = document.createElement("input"); check.type = "checkbox"; check.id = `local-${key}`;
  label.append(check, document.createTextNode(key === "ac" ? "AC" : key[0].toUpperCase() + key.slice(1)));
  const effective = document.createElement("span"); effective.id = `effective-${key}`; effective.className = "local-state";
  row.append(label, effective); $("#local-switches").append(row);
  check.addEventListener("change", () => changeScene(snapshot.session.scene.name, { localSwitches: Object.fromEntries(["light", "fan", "ac", "display"].map(name => [name, $(`#local-${name}`).checked])) }));
}
function render(state, force = false) {
  if (applying && !force) return;
  snapshot = state;
  const scene = state.session.scene, index = names.indexOf(scene.name), supply = state.master.reportedSupply;
  const effective = Object.fromEntries(["light", "fan", "ac", "display"].map(key => [key, supply === "on" && scene.localSwitches[key]]));
  $("#stage").className = `stage ${scene.name === "occupied" ? "occupied" : ""} ${index < 4 ? `scene-only ${scene.name}` : ""}`;
  text("#scene-title", labels[index]); text("#carousel-title", `${index + 1} / 7 · ${labels[index]}`);
  text("#supply-status", `Master ${supply.toUpperCase()} · simulated`);
  $("#scene-select").value = scene.name; $("#presenter-lock").checked = scene.locked;
  $("#previous").disabled = scene.locked; $("#next").disabled = scene.locked; $("#scene-select").disabled = scene.locked;
  for (const key of ["light", "fan", "ac", "display"]) {
    $(`#${key}-equipment`).classList.toggle("equipment-on", effective[key]);
    $(`#local-${key}`).checked = !!scene.localSwitches[key]; text(`#effective-${key}`, `Effective ${effective[key] ? "ON" : "OFF"}`);
    $(`#local-${key}`).disabled = scene.locked;
  }
  $("#marker-row").hidden = state.session.visionMode !== "instrumented";
  if (state.session.markerDataUrl && $("#marker").getAttribute("src") !== state.session.markerDataUrl) $("#marker").src = state.session.markerDataUrl;
  $("#manual-controls").hidden = !state.session.allowManualControl;
  $("#injection-controls").hidden = state.session.visionMode !== "scenario_injection";
}
async function changeScene(name, extra = {}) {
  if (!snapshot) return;
  try { await request("/scene", { name, ...extra }); render(await request("/state")); error(""); }
  catch (failure) { error(failure.message); render(snapshot); }
}
$("#scene-select").addEventListener("change", () => changeScene($("#scene-select").value));
const move = delta => { if (snapshot && !snapshot.session.scene.locked) changeScene(names[(names.indexOf(snapshot.session.scene.name) + delta + names.length) % names.length]); };
$("#previous").addEventListener("click", () => move(-1)); $("#next").addEventListener("click", () => move(1));
$("#presenter-lock").addEventListener("change", () => changeScene(snapshot.session.scene.name, { localSwitches: snapshot.session.scene.localSwitches, locked: $("#presenter-lock").checked }));
document.addEventListener("demo:state", event => render(event.detail));
document.addEventListener("demo:command", async event => {
  const command = event.detail;
  if (credential()?.role !== "classroom" || !snapshot || command.sessionId !== credential().sessionId || command.roomId !== snapshot.room._id || inFlight.has(command._id)) return;
  if (new Date(command.expiresAt) <= new Date()) { text("#command-status", "Expired command ignored; reconnect snapshot is authoritative"); return; }
  inFlight.add(command._id); applying = true;
  try {
    if (!acknowledged.has(command._id)) {
      render({ ...snapshot, master: { ...snapshot.master, reportedSupply: command.action } }, true);
      text("#command-status", `Command ${command.requestId.slice(0, 12)} applied ${command.action.toUpperCase()} locally · awaiting acknowledgement`);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    await request("/ack", { commandId: command._id, action: command.action, applied: true });
    acknowledged.add(command._id); if (acknowledged.size > 50) acknowledged.delete(acknowledged.values().next().value);
    text("#command-status", `Simulator acknowledged ${command.action.toUpperCase()} · ${command.requestId.slice(0, 12)} · no physical verification`);
    render(await request("/state"), true); error("");
  } catch (failure) {
    text("#command-status", "Application acknowledgement failed · result unverified"); error(failure.message);
    try { render(await request("/state"), true); } catch {}
  } finally { applying = false; inFlight.delete(command._id); }
});
for (const action of ["on", "off"]) $(`#master-${action}`).addEventListener("click", async () => {
  try { const command = await request("/master", { action, requestId: crypto.randomUUID() }); text("#command-status", `Command ${command.requestId.slice(0, 12)} created · awaiting delivery`); error(""); }
  catch (failure) { error(failure.message); }
});
for (const occupancy of ["vacant", "occupied"]) $(`#inject-${occupancy}`).addEventListener("click", async () => {
  try { await request("/inject", { occupancy, equipmentOn: true }); text("#command-status", `Explicit scenario injection: ${occupancy} · no camera pixels processed`); }
  catch (failure) { error(failure.message); }
});
$("#fullscreen").addEventListener("click", async () => {
  document.body.classList.add("presentation");
  try { await document.documentElement.requestFullscreen?.(); } catch {}
});
$("#exit-fullscreen").addEventListener("click", () => { document.body.classList.remove("presentation"); if (document.fullscreenElement) document.exitFullscreen?.(); });
await ready(); if (currentState()) render(currentState());
