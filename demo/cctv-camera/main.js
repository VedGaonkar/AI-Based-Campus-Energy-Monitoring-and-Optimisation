import { $, text, error, request, ready, credential } from "../shared/phone.js";
let stream, timer, active = false, sequence = Number(sessionStorage.getItem("demo-camera-sequence") ?? 0), controller;
const video = $("#video"), canvas = document.createElement("canvas");
async function stop(reason = "Camera stopped · occupancy unknown") {
  active = false; clearTimeout(timer); controller?.abort();
  stream?.getTracks().forEach(track => { track.onended = null; track.stop(); }); stream = null; video.srcObject = null;
  text("#capture-status", reason); $("#start").disabled = false; $("#stop").disabled = true;
  if (credential()) await request("/offline", {}).catch(() => {});
}
async function sample() {
  if (!active || document.hidden) return;
  try {
    if (!video.videoWidth || !video.videoHeight) throw new Error("Waiting for a usable video frame");
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    const capturedAt = new Date().toISOString(); canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = canvas.toDataURL("image/jpeg", .72).split(",")[1];
    if (image.length > 333000) throw new Error("Frame is too large; reduce camera resolution");
    controller = new AbortController(); const timeout = setTimeout(() => controller?.abort(), 10000);
    sequence++; sessionStorage.setItem("demo-camera-sequence", String(sequence));
    text("#capture-status", `Uploading sampled frame ${sequence}…`);
    let result;
    try { result = await request("/frames", { sequence, capturedAt, mime: "image/jpeg", image }, { signal: controller.signal }); }
    finally { clearTimeout(timeout); }
    if (active) {
      text("#last-frame", `${new Date(result.processedAt).toLocaleTimeString()} · #${sequence}`);
      text("#observation", `${result.observation.occupancy} · ${result.observation.evidenceSource.replaceAll("_", " ")}`);
      text("#capture-status", `Capturing · ${result.processingMs}ms pixel processing`); error("");
    }
  } catch (failure) { if (active) { error(failure.name === "AbortError" ? "Upload timed out. Discarding this frame and recovering." : failure.message); text("#capture-status", "Upload failed · recovering; stale evidence is unknown"); } }
  finally { if (active) timer = setTimeout(sample, 1000 / Number($("#fps").value)); }
}
async function start() {
  error("");
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return error("Camera unavailable. Open this app through trusted HTTPS (localhost works only on the laptop), using a browser with camera support.");
  await stop(); $("#start").disabled = true;
  try {
    const deviceId = $("#camera-select").value;
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }), width: { ideal: 640 }, height: { ideal: 480 } } });
    video.srcObject = stream; await video.play(); active = true; $("#stop").disabled = false;
    stream.getVideoTracks().forEach(track => { track.onended = () => stop("Video track ended · occupancy unknown"); });
    const selected = deviceId;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === "videoinput");
    $("#camera-select").replaceChildren(new Option("Prefer rear camera", ""), ...devices.map((device, i) => new Option(device.label || `Camera ${i + 1}`, device.deviceId)));
    $("#camera-select").value = selected; sample();
  } catch (failure) {
    await stop(); error(failure.name === "NotAllowedError" ? "Camera permission denied. Allow camera access in your browser settings, then start again." : `Could not start camera: ${failure.message}`);
  }
}
$("#start").addEventListener("click", start); $("#stop").addEventListener("click", () => stop());
$("#camera-select").addEventListener("change", () => { if (active) start(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && active) stop("App backgrounded · camera stopped; start again when ready"); });
document.addEventListener("demo:unpaired", () => stop("Phone unpaired · camera stopped"));
window.addEventListener("pagehide", () => stop());
await ready();
