import { BACKEND_ORIGIN } from "../shared/config.js";
import { captureJpeg } from "../shared/image-source.js";
const $ = selector => document.querySelector(selector), storage = "campus-meter-camera";
let pairing, stream, running = false, busy = false;
try { pairing = JSON.parse(sessionStorage.getItem(storage)); } catch {}
const error = value => { $("#error").textContent = value ?? ""; };
async function api(path, body) {
  const response = await fetch(`${BACKEND_ORIGIN}/api/v1/meter-phone${path}`, { method: body === undefined ? "GET" : "POST", credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(18000), headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(pairing ? { Authorization: `Bearer ${pairing.token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const json = await response.json(); if (!response.ok) throw new Error(json.error?.message ?? "Meter source unavailable"); return json.data;
}
function show() { $("#paired").hidden = !pairing; $("#pair-form").hidden = !!pairing; }
async function stop() { running = false; stream?.getTracks().forEach(track => track.stop()); stream = null; $("#video").srcObject = null; if (pairing) await api("/offline", {}).catch(() => {}); $("#connection").textContent = "Camera stopped; captures may be missed"; }
$("#pair-form").onsubmit = async event => { event.preventDefault(); try { pairing = await api("/pair", { code: $("#code").value.trim() }); sessionStorage.setItem(storage, JSON.stringify(pairing)); $("#code").value = ""; error(""); show(); await poll(); } catch (failure) { error(failure.message); } };
$("#start").onclick = async () => {
  try { if (!isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error("Use trusted HTTPS and a browser with camera permission"); stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } } }); $("#video").srcObject = stream; await $("#video").play(); running = true; error(""); await poll(); } catch (failure) { error(failure.message); }
};
$("#stop").onclick = stop;
$("#unpair").onclick = async () => { await stop(); pairing = null; sessionStorage.removeItem(storage); show(); };
async function poll() {
  if (!pairing || busy || document.hidden) return; busy = true;
  try {
    const data = await api(`/state?active=${running ? "1" : "0"}`); $("#name").textContent = `${data.camera.name} / ${data.camera.meterId} (${data.camera.dataMode})`;
    $("#schedule").textContent = `Next scheduled capture: ${new Date(data.camera.nextCaptureAt).toLocaleString()} / ${data.camera.intervalMinutes} minutes`;
    $("#connection").textContent = running ? "Connected; waiting for backend capture request" : "Paired; start the camera to satisfy captures";
    if (running && data.request) {
      const capturedAt = new Date().toISOString(), first = captureJpeg($("#video"), 1280, .84);
      await new Promise(resolve => setTimeout(resolve, 300));
      const result = await api("/frames", { captureId: crypto.randomUUID(), jobId: data.request.id, capturedAt, images: [first, captureJpeg($("#video"), 1280, .84)] });
      $("#result").textContent = `${result.status}: ${result.candidateKwh ?? "Unreadable"} kWh / ${result.validation?.reasons.join(", ") || "Clear candidate"}. OCR is not guaranteed accurate.`;
    }
    error("");
  } catch (failure) { error(failure.message); $("#connection").textContent = "Disconnected or capture failed; state is not current"; }
  finally { busy = false; }
}
const code = new URLSearchParams(location.hash.slice(1)).get("pair"); if (code) { $("#code").value = code; history.replaceState(null, "", location.pathname); }
document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); else poll(); }); window.addEventListener("pagehide", stop);
show(); poll(); setInterval(poll, 5000);
