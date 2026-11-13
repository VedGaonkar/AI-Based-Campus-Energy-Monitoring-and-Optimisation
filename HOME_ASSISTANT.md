# Existing equipment through Home Assistant

The separate [two-phone demonstration](DEMO_SETUP.md) uses only the existing simulated room master and simulated observations. It never calls HA for control, never satisfies a live native test gate and cannot turn native failure into breaker fallback. Stop/disable native room policy before temporarily assigning that room to a phone demo; HA connection data and reviewed device bindings remain intact.

Documentation/access checked: **13 November 2026**. Protocol/reference baseline: Home Assistant **2026.11.1** documentation and tagged core source; no real Home Assistant instance or physical equipment has been connected for this increment. Local protocol mocks and the campus simulator are software tests, not commissioned devices.

## What this increment implements

Open **Connected devices** in the sidebar, or **Admin management → Connected devices**. It uses the existing login, room scope, MongoDB, worker and room policies. One room master remains mapped to each controlled room. This optional extension can additionally request native OFF from reviewed **existing** smart appliances; it does not add IR, per-button actuators or smart-plug purchases.

| Route | Campus support | Actual prerequisite |
| --- | --- | --- |
| Isolated simulator | Implemented and default | Demo mode; no gateway/token/hardware/network control requests |
| Home Assistant | REST reads/OFF, WebSocket state subscription, explicit entity binding | Reachable HA instance, authorised token and exact supported entity |
| Shelly through HA | Onboarding guidance; discovered entities use the common adapter | Model/generation-specific [Shelly integration](https://www.home-assistant.io/integrations/shelly/) configuration |
| TP-Link Kasa/Tapo through HA | Onboarding guidance | Provision the exact supported model; newer devices may need account credentials for local authentication inside [HA's TP-Link integration](https://www.home-assistant.io/integrations/tplink/) |
| Tuya / Smart Life through HA | Onboarding guidance; cloud-dependent | Paired device/account, app user code and HA setup QR scanned using that app; some Bluetooth equipment needs a supported gateway. See [Tuya integration](https://www.home-assistant.io/integrations/tuya/) |
| Matter through HA | Onboarding guidance | Matter server/integration, supported device and Companion app; Thread equipment needs a suitable border router. Only Matter-capable equipment can use [multi-admin sharing](https://www.home-assistant.io/integrations/matter/) |
| SmartThings direct or through HA | Deferred; no direct adapter | Current API access plan, regional/account eligibility and OAuth; HA does not bypass provider requirements. Recheck [Samsung's policy announcement](https://blog.smartthings.com/smartthings-updates/smartthings-api-additional-details-for-developers-and-business-partners/) and [HA SmartThings](https://www.home-assistant.io/integrations/smartthings/) |
| Alexa/Bixby/Google Home APIs | Not implemented | Alexa skills expose your service to voice control; Google Home APIs need a separate supported mobile/permissions implementation. They are not universal Node.js device-import connectors |

A Wi-Fi connection, brand badge or voice-assistant link is not compatibility evidence. Home Assistant is open source, but hosting, radios, optional cloud services and vendor integrations can have costs. A local integration may work without internet while still needing a functioning LAN; cloud integrations need internet.

## Prepare the actual gateway

1. Install Home Assistant on a suitable **existing always-on host**, following [official installation instructions](https://www.home-assistant.io/installation/). This repository does not install HA or include a home-automation stack.
2. In HA, add the real equipment through its supported integration. Brand credentials remain in HA; do not enter Tuya/Amazon/Google/Samsung passwords into campus forms.
3. Verify the exact model, firmware, physical load, entity and native OFF behavior in HA. A sensor is not an actuator. Group/helper/scene actions can affect multiple loads and are excluded here.
4. Create an authorised **long-lived access token** from the HA profile's Security page. It is a sensitive bearer credential and can have broad authority; the campus allowlist does not restrict its permissions inside HA. See [HA authentication](https://developers.home-assistant.io/docs/auth_api/).
5. Verify that the **campus backend host**, not merely your browser, can reach the gateway. A hosted backend cannot automatically reach a campus `192.168.x.x` address. Use an explicitly designed private LAN/VPN path; an outbound site agent is not implemented. Do not expose port 8123 publicly by default.

## Deployment-controlled destination configuration

These optional variables are documented in [.env.example](.env.example). Defaults make no live control requests:

```dotenv
ALLOW_NATIVE_DEVICE_CONTROL=false
HA_ALLOWED_ORIGINS=
HA_ALLOW_HTTP=false
HA_ALLOW_LOOPBACK=false
```

Add the exact gateway **origin** to `HA_ALLOWED_ORIGINS`, then restart API and worker. Example only, not a supplied gateway:

```dotenv
HA_ALLOWED_ORIGINS=https://ha.campus.example
```

For a deliberately trusted LAN HTTP pilot, explicitly set `HA_ALLOW_HTTP=true` and allowlist the exact `http://<gateway-ip>:8123` origin. Use HTTPS with a trusted certificate whenever available. TLS validation stays enabled; a private CA may be configured narrowly through the host's trust configuration. Never disable TLS globally. Loopback is separately denied by default; the protocol tests explicitly enable it for their local mock.

The connector rejects URL credentials, non-root URL paths, queries/fragments, unlisted origins/ports, metadata/link-local addresses and IPv4-mapped IPv6 bypasses. It resolves approved hosts when saving a connection, stores their IP pins, revalidates on each request and injects the chosen IP into the actual HTTP/WebSocket socket lookup. DNS changes require an explicit connection update and review. Redirects are not followed. HTTP requests have fixed 5-second deadlines and JSON/body limits; WebSocket messages are bounded to 2 MiB. Large HA installations exceeding the discovery limit need a separately reviewed filtered-discovery extension.

## Campus-side onboarding

1. Sign in as an administrator and open **Connected devices → Add connection**.
2. Choose **Home Assistant**, enter the allowlisted URL and token, and save. The token is write-only and never returned to the browser or copied to logs.
3. Click **Test connection**. This tests authentication/API availability and reads the HA version; it never sends OFF. Inspect REST health and state-stream health separately.
4. Click **Discover**. The backend reads states/actions and, where permitted, entity/device registries. The list shows domain, state age, OFF candidate/read-only reason, physical device ID and optional HA area suggestion. Areas do not automatically assign campus rooms.
5. Select an exact entity and map an existing room. Optionally bind existing load inventory. Manual registration accepts connection ID plus an exact entity ID and validates it with an authenticated read; brand/model/name-only inventory is not executable.
6. In device details, classify the load and explicitly review identity, possible duplicate routes, model/firmware and OFF capability. Critical equipment, network/camera infrastructure and room masters cannot use this path. Saving a review resets automatic permission and the previous test.
7. Prepare a genuinely eligible vacant room. Bookings/preparation windows, QR leases, overrides, unknown/stale occupancy, room lockouts and unsafe/unavailable supply status block OFF. Live commands additionally require live occupancy evidence; replay cannot authorise them.
8. Approve **Request test OFF** for the named physical target. This uses the same backend policy, target binding, command expiry and reported-state checks as subsequent control. Check command history; HTTP acceptance is not OFF confirmation.
9. Only after a **confirmed explicit test in the current mode/configuration** can per-device automatic OFF be enabled. Select the room's separate native OFF policy. A simulated test cannot satisfy a live test gate. The room-master policy remains separate.

### Live control gates

Read-only HA testing/discovery can run while the campus app is in demo mode, but **no live OFF** can. For a commissioned native-device pilot, the operator must deliberately configure and restart:

```dotenv
DEMO_MODE=false
DEMO_TIME_SCALE=1
ALLOW_PHYSICAL_CONTROL=false
ALLOW_NATIVE_DEVICE_CONTROL=true
```

`ALLOW_PHYSICAL_CONTROL` remains false because no physical room-master adapter is commissioned. The native-control gate is separate. In addition, enable live OFF for the tested healthy connection, review the individual ordinary load, obtain a successful explicit live-mode test and enable its automatic permission. Select room native policy `live`. All required occupancy sources must supply current genuine live observations with validated coverage. No such live setup has been tested with real equipment here.

## Narrow native actions and identity rules

- `light`: exact entity, native `turn_off` action, explicit review/test.
- `fan`: `turn_off` action plus entity `FanEntityFeature.TURN_OFF` support (bit 16 in checked HA source).
- `switch`: `turn_off` only after review confirms the actual ordinary load. Matching room-master native IDs are excluded even if the entity name looks ordinary.
- `climate`: `set_hvac_mode` with `hvac_mode: off` only when the action exists and that entity advertises `off` in `hvac_modes`. `hvac_action: idle` does not mean OFF.
- Groups, scripts, scenes, buttons, locks, alarms, wildcard targets and arbitrary services are excluded. Detected optimistic state feedback is currently read-only for control; no independent measurement is inferred.

One physical HA device may expose several entities. The campus binding stores connection/instance origin identity separately from external entity ID, registry identity and physical device ID. Serial/MAC/identifier fingerprints help detect cross-route duplicates where available; otherwise the administrator must explicitly reconcile identity and possible duplicate routes. A configured origin fingerprint identifies the configured HA route, not a certified HA hardware UUID.

Unknown/renamed/deleted or changed registry identity disables control. Use **Reconcile entity / room binding** to read the exact replacement and reset permissions; the app never guesses a similar name. Unregistering retains command history. Changing URL/token/binding or reconnecting after an administrative disconnect requires review/tests again.

Inventory may mark `nativeOffRequired` where a breaker operation depends on a prior native shutdown. Such a room-master OFF remains blocked until matching fresh OFF confirmation exists. Native confirmation does not bypass an appliance's separate manufacturer normal-stop procedure, restart rules or essential-load protections.

## Commands, worker and evidence

The separate existing worker owns escalation. After confirmed vacancy and protection checks: first alert, HOD escalation after 10 policy minutes, final recheck after another 15. Demo mode scales these delays by 60, while retaining explicit simulated provenance.

Native jobs use the existing Mongo job collection with `kind: native_off`, stable command/job IDs, policy/device/connection revisions, atomic claiming, room locks and fixed expiry. Commands persist requested/dispatched/accepted/confirmed or already-off/failed/unverified/cancelled/expired status and history. The final stage selecting native OFF never falls back to a room-master command, even on provider failure. A required native shutdown also blocks a dependent breaker path when unverified.

The service uses [authenticated REST reads/actions](https://developers.home-assistant.io/docs/api/rest/), and [WebSocket authentication, `state_changed`, registry commands and ping/pong](https://developers.home-assistant.io/docs/api/websocket/) for ongoing state. It subscribes before getting a state snapshot; provider timestamps and conditional DB updates prevent an older reconnect snapshot from overwriting a newer event. Disconnects are visible; heartbeat timeouts and bounded exponential retries attempt reconnection. Cached states age out rather than remaining implicitly current.

Only an exact allowlisted service action can be sent. `POST /api/states` is **never** used for control. Service HTTP 200 is acceptance, followed by a fresh authenticated state read/event. Matching OFF is labelled **provider-reported OFF** (or **simulated**), never physically verified or measured zero power. Unknown/unavailable/disconnected states and room supply interruption do not confirm native OFF. A received response without OFF becomes unverified; later matching evidence can reconcile its command history.

Expired work is not replayed after downtime. A recovered dispatched/accepted command is read/reconciled rather than re-sent. Exactly-once external execution is not promised. Explicit OFF and duplicate suppression reduce repeat risk. New occupancy/protected use cancels pending work; already-dispatched uncertainty remains visible. External/manual ON after a completed automatic OFF suspends automatic permission instead of starting an endless OFF loop. No appliance ON restoration is implemented.

No command outcome is converted into measured energy or savings. Existing building-meter readings, equipment estimates and genuine per-device telemetry are separate; this increment does not add a per-device energy calculation.

## Credential storage and revocation

HA tokens are encrypted at rest with AES-256-GCM, random nonces, connection-bound authenticated data and a purpose-specific HKDF key derived from the server-only `SESSION_SECRET` outside MongoDB. The encrypted field is excluded from normal queries/responses. The credential is never returned to the browser. Protect and back up that server secret separately; rotating it requires re-entering HA tokens. Do not put tokens in `VITE_*` variables.

To replace a token, create the replacement in HA, use **Edit connection**, enter it in the write-only field, and re-test/review permissions. Revoke the old token in HA. To remove access, **Disconnect** identifies affected devices and cancels/reset their native work/permissions; also revoke the HA token. Disconnecting the campus app alone does not revoke the broad bearer credential inside HA.

## Simulator demonstration and verification

1. Create/test an **Isolated simulator** connection; discover and map `light.demo_lecture` to a demo room with validated simulated observation coverage (seeded R101 is suitable).
2. Review the exact ordinary target. Use **Prepare simulated vacancy**, wait for confirmed simulated vacancy, then approve **Request test OFF**. History must show simulated reported OFF.
3. Enable automatic OFF. Use **Simulate ON / confirms OFF** and keep the room vacant. Observe first alert, HOD escalation, final recheck, native OFF and reported result. The room master must stay ON with no fallback command.
4. Use simulated ON again. This suspends repeated automation after a prior automatic OFF; explicitly re-enable it, then **Simulate person returns** before the final stage. Pending work must cancel.
5. Use **Simulate ON / no OFF feedback**, prepare vacancy and enable/review as required. The result must remain unverified without breaker fallback. **Simulate unavailable** cannot become confirmed OFF.

Actual test results are maintained in [TESTING.md](TESTING.md), [PROGRESS.md](PROGRESS.md) and [HANDOFF.md](HANDOFF.md). Commands:

```bash
npm test
npm run check
npm run build
npm run test:devices-browser
```

The browser runner creates an isolated temporary MongoDB/API/worker and generated credentials. It requires installed Chrome/Edge or `BROWSER_EXECUTABLE`. Its screenshots/reports are ignored under `.local/`. No user gateway/token or real hardware is used. Protocol mocks implement HA authentication, REST state/action routes, WebSocket events/registries, connection loss and ordering; they are not physical acceptance tests.

## Versions, licences and live blockers

- Node runtime and application dependencies remain pinned in the existing workspace. Added a direct server dependency on already-installed **ws 8.21.3**, **MIT**; [source/API](https://github.com/websockets/ws/tree/8.21.3). Browser code does not receive this client or HA credentials.
- HA Core reference baseline **2026.11.1**, **Apache-2.0**, used as protocol/source reference only; not installed or copied into this repository. [Core source](https://github.com/home-assistant/core/tree/2026.11.1), [climate constants](https://github.com/home-assistant/core/blob/2026.11.1/homeassistant/components/climate/const.py), [entity registry commands](https://github.com/home-assistant/core/blob/2026.11.1/homeassistant/components/config/entity_registry.py), [fan features](https://github.com/home-assistant/core/blob/dev/homeassistant/components/fan/const.py), [climate actions](https://www.home-assistant.io/integrations/climate/).
- Still needed for physical validation: an always-on HA host and its version, a reachable allowlisted origin/trusted network, authorised HA token, exact device model/firmware/integration/entity/physical load, validated genuine occupancy sources and supervised approval/test evidence. None were supplied. HA installation, radio/Thread commissioning, VPN/site-agent deployment and physical electrical work are not silently performed.
- Direct SmartThings, Alexa/Bixby and Google mobile integrations remain deferred. Recheck their account eligibility, regional access and commercial terms if that later increment is selected. See [Alexa skill direction](https://developer.amazon.com/en-US/alexa/devices/connected-devices/development-resources/smart-home-skills), [HA Alexa](https://www.home-assistant.io/integrations/alexa.smart_home/), [Google Home APIs](https://developers.home.google.com/apis/android/overview) and [Google permissions](https://developers.home.google.com/apis/android/permissions).

Next live task: configure one eligible HA gateway read-only, verify identity/capabilities for one ordinary load, and conduct its supervised explicit OFF test before arming automatic live OFF.
