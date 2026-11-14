# Two-phone classroom demonstration

## Short demo flow (CE-023)

1. Open `/presenter`. If your room is not ready, expand **Prepare a room for simulation**. Select it, review the displayed independent-supply and ordinary-load checkboxes, then **Save simulation setup**. An empty room can add one explicitly approved **virtual demo light (20 W estimate)** in that form. Existing protected loads remain blocked; this is never electrical commissioning. You no longer need to visit Advanced settings and inventory dialogs for the same simulation review.
2. Choose a ready room, review the scene checkbox and **Create demo session**. Default QR mode/5-second vacancy/60-minute session are already set. Optional manual simulated-master requests still need their own explicit checkbox. **Advanced options** contains mode/timing changes. The active session reopens automatically on return; the new-session form then collapses.
3. Click **Prepare both phone links** once. Open the classroom and camera links on the intended devices, or scan their QRs. The one-use fragment connects the app automatically; manual code entry remains under **Enter pairing code manually**. Start the camera explicitly and grant permission. Camera permission/capture is not silently started. The bulk button preserves online pairings and still-valid generated links; **Replace camera/classroom pairing** is the explicit revoke/reissue path. Errors retain successfully prepared links so a retry does not revoke them.
4. Keep the classroom QR in the camera frame, with both apps visible. The default illustrated scene is empty/equipment ON. Use the classroom's visibly styled **Presenter controls** to change/lock scenes if needed. Fullscreen now keeps the QR visible beside/below the scaled illustration within the viewport. The presenter **Next step** explains missing classroom/camera connection or unknown QR evidence. Watch the existing5s/+10s/+15s persistent stages and simulator acknowledgement.

For a laptop without a separate display to film: choose **Explicit scenario injection** under Advanced options (only the classroom pairing is shown), or run `npm run test:phone-browser` for an isolated synthetic-stream rehearsal. Scenario injection remains labelled, is not pixel inference, and requires repeated observations for the confirmation window. Person-detection mode cannot infer vacancy from missing detections.

Button-like borders,44px touch targets and focus states now distinguish expandable setup/advanced/code controls. **Review load policy** is a normal secondary button and **Register a downstream load** is a button-styled native disclosure; Enter/Space and focus behaviour remain native. Existing advanced management paths below remain available. Backend eligibility,room roles,scoped one-use codes,expiry,bookings,master interlocks and demo/live separation are unchanged. This quicker flow never auto-approves actual user loads or changes the user's current session during development/testing.

CE-021 integration: canonical direct setup is **`/presenter`**, with existing Administrator authentication; it has a separate layout and is absent from normal product navigation and overview. `/phone-demo` remains only a direct compatibility alias. Camera/classroom pairing, sessions, adapters, persisted commands and acknowledgements are preserved. Room/device registration is independent under `/admin/rooms`, `/admin/controllers` and the existing inventory/actions. New administrators still start empty; optional fixtures belong in an explicitly separate demonstration institution/backend. See [DEPLOYMENT.md](DEPLOYMENT.md) for exact three-app builds, public API/real-time origins, HTTPS hosting, private server variables, migration and backup order.

## What each address or binding means

| Item | Meaning | What it cannot prove |
| --- | --- | --- |
| Website/app URL | Address that opens the camera, classroom or dashboard UI | Camera frames, feed health, electrical control or device identity |
| Registered source/camera ID | Immutable server record mapping evidence to a room/meter | A working video stream or verified coverage |
| Short-lived paired camera/client token | Authorises that role/session/institution to upload bounded frames | Real-world occupancy accuracy, another room, administrator access or master control |
| Room-master binding | Maps one room to one registered master/circuit and approved downstream inventory | Actual wiring, independent appliance controls or an electrical installation |
| Feed/transport configuration | Actual permitted browser camera capture or authenticated local gateway plus reachable API/socket transport | That an arbitrary website or RTSP-looking string is usable or safe |
| Acknowledgement | Current simulated command ID applied by the paired virtual classroom | Physical breaker motion, zero power or measured savings |

Never enter an arbitrary website URL as a camera/controller connection test. Current registration uses supported adapters, exact IDs, scoped pairing or an authenticated gateway. Live CCTV/NVR requires a reachable authorised gateway and reviewed feed configuration, not merely a stored address. Existing native gateway setup has its own authenticated endpoint tests; it is not the phone simulator.

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
| Separate authenticated presenter / setup | `http://localhost:5173/presenter` | Existing `npm run dev` |
| Phone A camera | `http://localhost:5000/demo/cctv-camera/` | `demo/cctv-camera/index.html`; optionally `npm run demo:camera` → `http://localhost:5174/cctv-camera/` |
| Phone B classroom | `http://localhost:5000/demo/circuit-board/` | `demo/circuit-board/index.html`; optionally `npm run demo:classroom` → `http://localhost:5175/circuit-board/` |

Both phone apps retain independent HTML/CSS/JavaScript source entry points. `npm run build:phone-camera` produces `dist/phone-camera/`; `npm run build:classroom` produces `dist/virtual-classroom/`; `npm run build:main` produces `frontend/dist/`. `npm run build` builds/checks all artifacts. The backend serves their built files under `/demo/`, with relative assets and a local Socket.IO client. Main/presenter is a SPA; phone artifacts can also be hosted independently at their roots. Standalone development commands proxy `/api` and `/socket.io` to the same backend. They do not start another backend or MongoDB. Stop standalone previews with Ctrl+C; `npm run stop` stops only managed application services and preserves reused/external MongoDB.

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

Keep existing session/password/admin configuration. Camera/classroom apps receive only short-lived scoped demo credentials; never copy an administrator password, admin key, ingestion secret or HA token into them. `demo/shared/config.js` defaults to the current origin; no client calls the laptop through a hardcoded localhost URL. If separately hosted, deliberately set its HTTPS backend origin and configure exact server origins/CORS using the build-origin settings and exact allowlists in DEPLOYMENT.md; same-origin HTTPS remains the recommended topology.

## Trusted HTTPS across laptop and two phones

Use one reachable HTTPS origin for all three interfaces and the Socket.IO endpoint. No external tunnel or publication is created by these scripts.

1. Put the laptop and phones on a network that allows peer communication. Guest Wi-Fi/client isolation can prevent access. Identify/reserve the laptop's actual private address; do not use the example IP blindly.
2. Use an existing trusted HTTPS reverse proxy, or install Caddy deliberately following its official instructions. Copy [demo/Caddyfile.example](demo/Caddyfile.example) to a local configuration and replace its address with the laptop's real IP. Its `tls internal` uses that instance's local CA, and `reverse_proxy` forwards both application HTTP and WebSocket traffic to the loopback-only API.
3. Trust the Caddy local **root certificate** on the laptop and both phones using their OS certificate installation/trust process. Obtain it from the Caddy instance's configured data directory (`pki/authorities/local/root.crt`); share the public certificate only, never the CA private key. An administrator may need to approve certificate installation. A certificate warning/click-through alone is not a tested secure camera context. Public-domain HTTPS with a valid trusted certificate is an alternative when an existing deployment is available.
4. Allow the chosen proxy's inbound TCP 443 on the laptop's private network profile, scoped to the demonstration network. Keep Node/Mongo/vision loopback-only. No public router port forwarding is needed for this same-LAN demo. Recheck any hostname/DNS resolution from both phones.
5. Build and stop the managed development run before starting the built application on the same port. Keep the existing MongoDB running. In both API and worker terminals set `NODE_ENV=production`, `DEMO_MODE=true`, `ALLOW_PHYSICAL_CONTROL=false`, `ALLOW_NATIVE_DEVICE_CONTROL=false`, `PUBLIC_APP_URL=https://<actual-laptop-IP>` and `FRONTEND_ORIGIN=https://<actual-laptop-IP>`, `DEMO_PHONE_ORIGINS=` (empty), `DEMO_TIME_SCALE=1` and `HOST=127.0.0.1` (without angle brackets). Keep the same existing server secrets/database. Then run `npm start` and `npm run worker` in separate terminals. This enables secure session cookies; the API trusts its single reverse-proxy hop and remains bound to loopback.
6. Run the deliberately configured proxy, for example `caddy run --config <your-local-Caddyfile>`. Open `https://<actual-laptop-IP>/presenter` on the laptop and the generated `/demo/cctv-camera/` and `/demo/circuit-board/` pairing links on the phones. Use the exact same origin throughout. Secure pages must use HTTPS/WSS transport, not HTTP/WS mixed content.

Official references checked: [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [TLS internal](https://caddyserver.com/docs/caddyfile/directives/tls), [local HTTPS/trust](https://caddyserver.com/docs/automatic-https). A proxy binary, its CA trust and actual network were not supplied/tested here. The prepared configuration is not evidence of deployment. See DEPLOYMENT.md for prepared host files and an isolated judge deployment. No hosting, external tunnel or publishing is authorised by these preparation instructions.

## Pair and prepare

### If created rooms say “No available rooms”

Room/floor creation registers identity and a simulated master; it does not automatically approve supply independence or downstream loads. Expand **rooms unavailable for demo setup** beneath the presenter form to see the current reason for each room. An online mapped master alone is insufficient.

For an isolated virtual demonstration room:

1. Open **Admin management > Advanced settings** (`/admin/settings`). Under **Room policy & assignments**, choose the exact room in **Configure room**. Review and check **Observation, network and essential supplies stay available**, then **Save room policy**. This means the camera/browser/network remains powered when the virtual ordinary-load master turns OFF; it is not a real electrical-installation approval.
2. Open **Rooms** (`/rooms`), choose **View room & actions** for that room and expand **Register a downstream load**. Add the ordinary simulated equipment you intend to demonstrate, for example a virtual light, using **Register inventory only**. Inventory registration starts unapproved.
3. For each registered load, choose **Review load policy**, review **Shared interruption approved** and save using **Save load policy**. Essential or essential-standby loads intentionally block room-wide cutoff; do not relabel real protected equipment just to make a demo selectable. Normal-stop/restart requirements remain enforced at command time.
4. Return to `/presenter` (refresh if necessary). Once the room has reviewed independent supplies, at least one reviewed eligible load, an online correctly bound simulator master, no existing demo owner and native appliance policy alert-only, it appears in **Existing room**. Creating the phone session then sets its scoped simulated room policy/source automatically; real camera coverage need not be fabricated.

CE-022 diagnosis (14November2026): fresh read-only checks found the five newly registered rooms present with mapped online simulator masters but independent-supply review false and zero load inventory. An isolated API reproduction verifies the sequence: independence block -> missing inventory -> unapproved load -> selectable after review -> successful simulated session creation. No user's approvals or inventory were changed by the diagnostic. Current targeted results are in HANDOFF.md.

1. Open `/presenter` directly and sign in as an existing authorised Administrator with email/password. The private server key is needed only when creating a new Administrator account; presenter use never asks for it. This setup screen is separate from the product shell and has no dashboard navigation/overview link. Select one existing room with a simulator master and reviewed ordinary inventory. Existing bookings, leases, overrides, critical loads, AC stop requirements and fault/maintenance restrictions remain authoritative.
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
- The authenticated presenter shows private latest thumbnail, source/freshness, occupancy/equipment evidence, protections, escalation jobs/timeline, command delivery and virtual-classroom acknowledgement. The latest thumbnail expires after two minutes and is cleared at session end; only scoped administrators can read it. No video archive is created. Minimal observation/command metadata remains for audit.

The strongest supported result here is **simulator acknowledged OFF**. A later camera decode of the new OFF marker is separate instrumented visual evidence. Neither is physical breaker verification, measured zero power, room kWh or measured savings. Native-device failures never trigger room-wide fallback, and HA integration remains independent.

## Judge script

Concise judge run (about2minutes after setup): show the normal product without a demo link, open the separate presenter URL, state “software simulation, not physical switching,” pair Phone A/B and lock empty/ON. Keep the camera visible. Show accepted pixels and the separate vacancy/+10s/+15s persistent stages. Show one master OFF and application acknowledgement, then the subsequent observed OFF marker. Start another eligible episode and choose occupied to cancel it. Stop the camera to show unknown, end the session to revoke pairing, then return to recorded consumption/ESG with source/mode/assumption labels. A decrease is recorded change, not software-attributed verified savings. If physical filming fails, explicitly name scenario injection or the synthetic browser rehearsal instead of calling it live inference.

1. Show the three interfaces and the simulated/vision-source labels. State that one virtual master controls all ordinary illustrated loads, while camera/control equipment stay powered.
2. Pair the devices, lock empty/ON, start Phone A and show accepted-frame processing/source. Explain the separate 5-second vacancy period.
3. Show immediate first notification, +10-second escalation and +15-second final recheck in the persistent dashboard timeline. Keep frames flowing and both phone apps visible.
4. Show Phone B equipment turning OFF, its application acknowledgement, and the dashboard result. Then show a subsequent camera-observed OFF marker without calling it measured savings.
5. For another episode, request manual simulated ON if authorised and eligible, select empty/ON, then switch to occupied before final evaluation. Unlock/relock the presenter deliberately. Show pending work cancelled by decoded occupancy. Add a booking, QR lease or override using existing dashboard flows to demonstrate protected use.
6. Stop Phone A: occupancy becomes unknown. Disconnect Phone B during delivery: outcome stays unverified/expired. Reconnect and show state resynchronisation without expired command replay. Stop/reset the session and show old phone access revoked.

## Troubleshooting and remaining physical checks

Physical-phone rehearsal (not completed by automated tests):

- [ ] Supply the actual laptop/host, two selected phones/browsers and a reachable LAN/DNS path; check guest Wi-Fi/client isolation and roaming.
- [ ] Open the exact HTTPS URL on both devices with no certificate warning; trust the deliberate local CA or use a public trusted certificate. Verify WSS/polling and no mixed content.
- [ ] Pair the correct roles with one-use current codes; verify expiry, role revocation and no administrator secrets on either phone.
- [ ] Test rear/alternate camera selection, permission denial/recovery, no audio, hidden-tab/lock-screen behaviour and explicit restart after foregrounding.
- [ ] Film the actual classroom screen with the QR fully visible. Try portrait/landscape, seated/edge views, glare, moire, focus and changing brightness. Record observed failures; do not use no-person HOG output as vacancy.
- [ ] Keep video and classroom transport active through vacancy, first notification,+10seconds,+15seconds and acknowledged simulated OFF; verify all ordinary illustrated loads and independent camera/network supplies.
- [ ] Change to occupied/booking/QR/override before final cutoff; verify cancellation. Disconnect camera to show unknown and classroom during delivery to show unverified/expired; reconnect without stale command replay.
- [ ] End/reset the session and verify old paired tokens no longer work. Rehearse worker restart/source loss without replaying expired actions.
- [ ] Keep electrical controls disabled. Any actual controller, wiring, AC normal-stop/restart or meter calibration needs separate qualified commissioning; this checklist does not approve it.

Needed but not supplied/tested: actual phones and filmed display, trusted LAN/public HTTPS endpoint and mobile CA trust, deployed Linux/Docker engine, licensed real footage/coverage, actual meters/controllers/HA credentials and independent electrical outcome evidence. Live Gemini credentials/model/quota are optional and separately unverified. See latest HANDOFF/TESTING for fresh software results; earlier milestone counts are historical.

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
