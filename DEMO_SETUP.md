# Two-phone classroom demonstration

Implementation/reference access: 13–14 November 2026. This milestone connects a real browser frame-upload path and Python pixel processing to the existing campus policy engine and an acknowledged **simulated** room master. Physical phone filming, real teammate detection, LAN/firewall and mobile certificate trust still need field testing. Do not present the automated canvas-camera check as a real two-phone demonstration.

## Start the three interfaces locally

From the repository root, keep the existing MongoDB/configuration and install no extra Node stack. Never reset the user's database for this demonstration.

```bash
npm run build
npm run dev
```

This starts/reuses the existing database, API, persistent worker and dashboard. The optional vision subprocess starts and warms up when an instrumented/inference session is created. No separate Python HTTP daemon, credentials or scheduler is needed.

| Interface | Laptop development URL | Independent entry point/start command |
| --- | --- | --- |
| Dashboard / session administration | `http://localhost:5173/phone-demo` | Existing `npm run dev` |
| Phone A camera | `http://localhost:5000/demo/cctv-camera/` | `demo/cctv-camera/index.html`; optionally `npm run demo:camera` → `http://localhost:5174/cctv-camera/` |
| Phone B classroom | `http://localhost:5000/demo/circuit-board/` | `demo/circuit-board/index.html`; optionally `npm run demo:classroom` → `http://localhost:5175/circuit-board/` |

Both phone apps are buildless HTML/CSS/JavaScript and are also served by the existing backend under `/demo/`. `npm run build` builds the dashboard and validates both independent phone entry points/assets. Standalone development commands proxy `/api` and `/socket.io` to the same backend. They do not start another backend or MongoDB. Stop standalone previews with Ctrl+C; `npm run stop` stops only managed application services and preserves reused/external MongoDB.

These localhost URLs work on the laptop. **On a phone, localhost means that phone**, not the laptop. Use the HTTPS preparation below before the physical demonstration.

### Python dependency preparation

The implementation was exercised with Python 3.11, imported OpenCV 4.10.0, NumPy 2.2.2 and Pillow 11.1.0. Use an isolated environment if these are not available:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r vision/requirements-demo.txt
```

Set `DEMO_VISION_PYTHON` to that environment's Python executable, using an absolute path, then restart API/worker. The worker path is a deployment setting, never supplied by a phone. Do not install competing OpenCV wheel variants into one environment. The pre-existing machine had multiple OpenCV wheel metadata records; no global packages were changed for this milestone.

Configuration examples (placeholders, not secrets):

```dotenv
DEMO_MODE=true
ALLOW_PHYSICAL_CONTROL=false
ALLOW_NATIVE_DEVICE_CONTROL=false
DEVICE_ADAPTER=simulator
DEMO_VISION_PYTHON=python
DEMO_PHONE_ORIGINS=http://localhost:5174,http://localhost:5175
PUBLIC_APP_URL=http://localhost:5000
FRONTEND_ORIGIN=http://localhost:5173
```

Keep existing session/password/admin configuration. Camera/classroom apps receive only short-lived scoped demo credentials; never copy an administrator password, admin key, ingestion secret or HA token into them. `demo/shared/config.js` defaults to the current origin; no client calls the laptop through a hardcoded localhost URL. If separately hosted, deliberately set its HTTPS backend origin and configure exact server origins/CORS through a separately reviewed deployment; the tested/recommended topology is same-origin.

## Trusted HTTPS across laptop and two phones

Use one reachable HTTPS origin for all three interfaces and the Socket.IO endpoint. No external tunnel or publication is created by these scripts.

1. Put the laptop and phones on a network that allows peer communication. Guest Wi-Fi/client isolation can prevent access. Identify/reserve the laptop's actual private address; do not use the example IP blindly.
2. Use an existing trusted HTTPS reverse proxy, or install Caddy deliberately following its official instructions. Copy [demo/Caddyfile.example](demo/Caddyfile.example) to a local configuration and replace its address with the laptop's real IP. Its `tls internal` uses that instance's local CA, and `reverse_proxy` forwards both application HTTP and WebSocket traffic to the loopback-only API.
3. Trust the Caddy local **root certificate** on the laptop and both phones using their OS certificate installation/trust process. Obtain it from the Caddy instance's configured data directory (`pki/authorities/local/root.crt`); share the public certificate only, never the CA private key. An administrator may need to approve certificate installation. A certificate warning/click-through alone is not a tested secure camera context. Public-domain HTTPS with a valid trusted certificate is an alternative when an existing deployment is available.
4. Allow the chosen proxy's inbound TCP 443 on the laptop's private network profile, scoped to the demonstration network. Keep Node/Mongo/vision loopback-only. No public router port forwarding is needed for this same-LAN demo. Recheck any hostname/DNS resolution from both phones.
5. Build and stop the managed development run before starting the built application on the same port. Keep the existing MongoDB running. In both API and worker terminals set `NODE_ENV=production`, `DEMO_MODE=true`, `ALLOW_PHYSICAL_CONTROL=false`, `ALLOW_NATIVE_DEVICE_CONTROL=false`, `PUBLIC_APP_URL=https://<actual-laptop-IP>` and `FRONTEND_ORIGIN=https://<actual-laptop-IP>` (without angle brackets). Keep the same existing server secrets/database. Then run `npm start` and `npm run worker` in separate terminals. This enables secure session cookies; the API trusts its single reverse-proxy hop and remains bound to loopback.
6. Run the deliberately configured proxy, for example `caddy run --config <your-local-Caddyfile>`. Open `https://<actual-laptop-IP>/phone-demo` on the laptop and the generated `/demo/cctv-camera/` and `/demo/circuit-board/` pairing links on the phones. Use the exact same origin throughout. Secure pages must use HTTPS/WSS transport, not HTTP/WS mixed content.

Official references checked: [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [TLS internal](https://caddyserver.com/docs/caddyfile/directives/tls), [local HTTPS/trust](https://caddyserver.com/docs/automatic-https). A proxy binary, its CA trust and actual network were not supplied/tested here. The prepared configuration is not evidence of deployment. For a tunnel or hosted service, obtain explicit authorisation and design its authentication/network path first.

## Pair and prepare

1. Sign in to the existing dashboard as a key-verified administrator. Open **Two-phone demo**. Select one existing room with a simulator master and reviewed ordinary inventory. Existing bookings, leases, overrides, critical loads, AC stop requirements and fault/maintenance restrictions remain authoritative.
2. Select a vision mode and review the stated simulated-scene coverage. Set vacancy confirmation independently (default 5 seconds; 2–60 allowed). A session lasts at most two hours. Optional presenter manual master requests require the separate checkbox. Native room policy must be alert-only before using this room; the demo never falls through to HA.
3. Create a camera pairing for Phone A and a classroom pairing for Phone B. Scan their QRs or enter their codes on the proper app. Pairing codes expire in five minutes and are one-use. Reissuing a role revokes its previous token. Links keep the code in the URL fragment and remove it from the address bar; token storage is session-only. Ending/resetting a session revokes old pairings.
4. On Phone B select **Empty classroom · equipment ON**. Review local switches, master supply and effective load states. Use presenter lock to freeze the scene. No automatic carousel advance occurs. Fullscreen presentation hides controls; an exit button remains available. The page/control channel stay powered when the ordinary master is OFF.
5. On Phone A allow camera permission and start capture. Prefer the rear camera; choose another camera where available. Audio is never requested. Keep the app visible and awake. Hidden tabs, stopped tracks and network loss make evidence stale/unknown; after backgrounding, explicitly start again.

Supported baseline: current Chrome/Edge on Android and Safari on iOS with `getUserMedia`, canvas/video support, session storage and HTTPS. Fullscreen availability varies; CSS presentation works when the native fullscreen request is unavailable. Camera selection may require initial permission. Test the exact phone/browser combination rather than promising universal mobile support.

## Vision modes and limits

**Instrumented demo vision** decodes a session-specific, signed QR from the submitted image pixels using OpenCV. It encodes illustrated occupancy and each load's effective state. Phone B choosing a scene does not directly submit a camera observation. The backend accepts only the matching session/epoch/signature after pixel decoding. Filming an old valid scene marker can still report that old illustration: this convention is not real-world occupancy proof or anti-replay camera attestation.

The visible QR must be in focus and large enough. Start at one frame/second; frame rate is selectable from 0.5 to 2. Use good display brightness without glare, keep both devices still and square to one another, include the whole QR/quiet border and avoid reflections or very close focus. On a small display, landscape presentation or moving the camera closer may help. Start with 50–80% display brightness and adjust for moiré/exposure; exact settings require physical testing.

**Camera inference** runs OpenCV's built-in default HOG/SVM pedestrian detector on actual frames. It is a limited person-positive path, especially weak for seated/partly hidden people. A positive detection protects the room; no detection, unusable/failed frames or insufficient evidence stays **unknown**, never vacant. Detector margin scores are not calibrated probabilities. Equipment state remains unknown in this mode: recognising an object would not prove it is operating. Test with a consenting real teammate, including seated/edge-of-frame cases, before claiming any field usefulness. This increment does not certify full-room coverage or enable physical control.

**Scenario injection** is an explicit fallback with a separate server mode/source label. Presenter/classroom roles may inject an observation; camera uploads are rejected in that mode. It never appears as successful pixel inference. Repeated injections, like observations, must satisfy the existing temporal/freshness rules.

All three modes remain `dataMode: simulated`; even camera-inference pixels in this milestone cannot authorise a physical/HA action. No facial recognition, attendance or audio processing exists.

## Transport, timing and outcomes

- Browser capture sends only sampled resized JPEG frames: maximum 640px long edge by default, one upload in flight, at most 250KB decoded transport bytes. Obsolete frames are dropped. Backend validation requires capture time within five seconds, monotonic per-pair sequence, JPEG/PNG signature/dimensions ≤960×720 and bounded processing. One frame per session and at most two Python tasks globally may be outstanding. A late frame cannot refresh evidence by replacing its capture timestamp.
- Phone camera source freshness is four seconds. Healthy continuous vacant marker observations must span the session's separate confirmation period. Only then does the existing Mongo-backed scheduler open an incident, notify immediately, escalate after 10 seconds, and finally recheck after 15 additional seconds. Browser countdowns display server job deadlines only. Production 10-minute/+15-minute settings remain unchanged; authorised phone sessions store their own timing evidence.
- Current occupancy, bookings/preparation, QR leases, overrides, policy versions, required native prerequisites, critical loads, stop/restart and interlocks are checked through existing context/policies. Unknown evidence cancels/suspends cutoff. A new occupied marker or protected use invalidates pending work.
- Phone B receives explicit ON/OFF with command IDs/deadlines over a scoped `/demo-phone` Socket.IO namespace (HTTP state/command polling recovers the transport). Created, sent and application-acknowledged are different states. The existing simulator changes durable supply only after a valid current-session acknowledgement. Every effective ordinary load becomes OFF together. Duplicate commands cannot toggle, and expired work is not delivered after reconnection.
- No acknowledgement means expired/unverified, never successful shutdown. A sent command without acknowledgement blocks another automatic attempt until session reset. Reconnection resynchronises the authoritative backend state; the last local animation cannot overrule it. Supply restoration uses the existing policy and never bypasses fault/maintenance/manual-isolation/restart restrictions. Stopping a session never automatically energises supply.
- The dashboard shows private latest thumbnail, source/freshness, occupancy/equipment evidence, protections, escalation jobs/timeline, command delivery and virtual-classroom acknowledgement. The latest thumbnail expires after two minutes and is cleared at session end; only scoped administrators can read it. No video archive is created. Minimal observation/command metadata remains for audit.

The strongest supported result here is **simulator acknowledged OFF**. A later camera decode of the new OFF marker is separate instrumented visual evidence. Neither is physical breaker verification, measured zero power, room kWh or measured savings. Native-device failures never trigger room-wide fallback, and HA integration remains independent.

## Judge script

1. Show the three interfaces and the simulated/vision-source labels. State that one virtual master controls all ordinary illustrated loads, while camera/control equipment stay powered.
2. Pair the devices, lock empty/ON, start Phone A and show accepted-frame processing/source. Explain the separate 5-second vacancy period.
3. Show immediate first notification, +10-second escalation and +15-second final recheck in the persistent dashboard timeline. Keep frames flowing and both phone apps visible.
4. Show Phone B equipment turning OFF, its application acknowledgement, and the dashboard result. Then show a subsequent camera-observed OFF marker without calling it measured savings.
5. For another episode, request manual simulated ON if authorised and eligible, select empty/ON, then switch to occupied before final evaluation. Unlock/relock the presenter deliberately. Show pending work cancelled by decoded occupancy. Add a booking, QR lease or override using existing dashboard flows to demonstrate protected use.
6. Stop Phone A: occupancy becomes unknown. Disconnect Phone B during delivery: outcome stays unverified/expired. Reconnect and show state resynchronisation without expired command replay. Stop/reset the session and show old phone access revoked.

## Troubleshooting and remaining physical checks

| Symptom | Check/action |
| --- | --- |
| Camera unavailable / permission denied | Verify trusted HTTPS and secure context, camera permission, supported browser and no other app monopolising the camera. HTTP LAN URLs are insufficient. |
| Pairing fails | Correct role, code under five minutes, one use, same session/backend origin; reissue code after reset/revocation. |
| Seed admin cannot sign in | Existing accounts are preserved, not reseeded/reset. In this workspace `admin@campus.test` is inactive/HOD; use your existing active administrator and current admin key. Do not assume changing DEMO_PASSWORD updates an existing account. |
| Origin rejected or no real-time channel | Match `PUBLIC_APP_URL`/`FRONTEND_ORIGIN`; proxy `/api` and `/socket.io` on the same HTTPS origin. No phone localhost or mixed HTTP/WSS endpoints. |
| Vision unavailable at session creation | Verify `DEMO_VISION_PYTHON`, isolated requirements, Python executable access and OpenCV imports. No silent installation/fake inference occurs. |
| Unreadable marker / unknown | Increase QR size, focus/brightness and full-frame visibility; reduce glare/moire/perspective. Use exact current session marker. Never relabel failure as vacancy. |
| Stale frame | Check phone/laptop clocks, CPU/network and rate. Cold worker warms during session creation; discard old captures and retry current ones. |
| No incident | Check confirmed vacancy duration, fresh continuous frames, observed effective equipment ON, booking/preparation/lease/override and reset-required error. |
| Master action blocked | Inspect complete inventory, native shutdown prerequisites, critical/AC stop policy, independent supplies, master health and fault/maintenance/manual isolation. Demo creation does not approve them. |
| Sent but no acknowledgement | Bring classroom online/visible, check expiry and inspect command history. Reset after uncertain automatic outcome; never claim successful OFF. |

Executed checks/results are in TESTING.md/PROGRESS.md/HANDOFF.md; run `npm test`, `npm run check`, `npm run build` and `npm run test:phone-browser`. The browser runner creates isolated data/generated credentials, renders actual classroom pixels into a synthetic canvas MediaStream, uploads through Phone A's normal code and uses Python plus the real worker/ack path. This tests software transport/policy/UI, not physical cameras or screen filming.

Remaining field checklist: select the two phones/browsers; establish/trust the actual HTTPS origin and firewall path; test camera rear/selection/permission/background/recovery; film the physical display under real glare/moire and network loss; test a consenting teammate separately with positive HOG results; verify expired/duplicate/ack/reconnect behavior across those devices. No phones, teammate, actual LAN certificate trust or proxy binary were supplied. Next action is this supervised two-phone rehearsal, without HA/electrical switching.

## Versions and sources

No new Node runtime dependency or external model was downloaded. Existing Socket.IO server/client 4.8.4 (MIT), qrcode 1.5.4 (MIT), React/Vite and MongoDB infrastructure are reused. Python requirements pin opencv-contrib-python 4.10.0.84 (OpenCV Apache-2.0 reference), NumPy 2.2.2 (BSD-3-Clause), Pillow 11.1.0 (HPND). The default HOG detector is bundled with OpenCV; no custom accuracy or commercial installation claim is made. Check third-party notices for redistribution.

References checked: [OpenCV QR detector source/example](https://github.com/opencv/opencv/blob/4.10.0/samples/python/qrcode.py), [HOG API](https://docs.opencv.org/4.x/d5/d33/structcv_1_1HOGDescriptor.html), [OpenCV licence](https://github.com/opencv/opencv/blob/4.10.0/LICENSE), [getUserMedia and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia), [camera enumeration](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices), [Socket.IO namespaces](https://socket.io/docs/v4/namespaces/). Context7 resolved OpenCV and fetched pixel-decoding APIs; Caddy was resolved before checking its current official primary documentation within the per-request CLI budget.
