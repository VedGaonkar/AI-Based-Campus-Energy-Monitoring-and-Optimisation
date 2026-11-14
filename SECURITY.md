# Security and Control Requirements

## Institution isolation (CE-013)

Operational access requires an active password-authenticated account, immutable active membership and local role/room scope. A sole membership opens automatically; multiple memberships require authorised post-password selection. Client IDs/roles and display names never grant access. Administrator registration creates a separate empty building; a Building Join Code grants only Viewer. Public discovery and former identity-code/invitation endpoints are retired.

Per-institution Mongo databases, bound models and isolated service/provider caches enforce operational separation even for overlapping local IDs. Unscoped model access fails closed. Jobs use the same bound database; root sockets check session membership and qualified rooms, while phone sockets validate institution-qualified capabilities repeatedly. Public routing prefixes are pointers, not authorization. Gateway credentials/HMACs include institution identity; no arbitrary client database names/credentials are accepted. Exports/assistant paths use the same authorised services.

Migration retains source IDs/password hashes/roles/inactive state and refuses ambiguous ownership; back up and stop writers before applying. Directory/account plus operational membership writes span databases without a transaction: caught provisioning failures compensate only new records; crash-interrupted inactive provisioning needs operator reconciliation without altering existing users. Directory and all generated databases must be backed up together. MongoDB privileges are shared application infrastructure, not independent infrastructure security. Production shared throttling, full recovery/lifecycle and external security assessment remain pending. See [INSTITUTIONS.md](INSTITUTIONS.md).


## Two-phone demo extension (CE-011)

Existing admin password/key sessions, CSRF and room scope authorise session/pairing management. Phones receive scoped expiring capabilities, not admin/HA secrets or a new user identity. Five-minute single-use pairing codes and tokens are hashed/query-excluded and never audited/exported. Reissue/reset/end revokes access. Fragment codes are removed from the URL; tokens stay in sessionStorage. Exact origins, bearer checks and rate/size limits protect phone mutations; cookies alone cannot authorise them. The Socket.IO namespace rechecks grants and isolates session/role payloads.

Uploads carry bounded JPEG/PNG bytes, capture timestamps and increasing sequences. Signature/dimension/age checks, one frame per session and a global two-task limit prevent unbounded work. No arbitrary source URLs or public inference port exist. Python is deployment-selected, local and makes no model downloads. Failed/unreadable/stale pixels become unknown; HOG scores are not calibrated probabilities. Signed marker/injection observations stay explicitly simulated and cannot authorise live HA/physical action.

Only scoped administrators can read the latest private thumbnail: no-store, two-minute expiry, removed on end; no audio, identity recognition or video archive. Trusted HTTPS/camera consent and actual network checks are required; [DEMO_SETUP.md](DEMO_SETUP.md) and the Caddy example prepare but do not install/deploy/trust a LAN or tunnel.

Explicit commands resolve the one simulated room master and recheck deadline/policy/interlocks at delivery and ACK. Critical-load/native prerequisites and fault/maintenance/restoration restrictions remain enforced. Missing classroom ACK cannot be successful shutdown; expired work is not replayed. Session end cancels work without energising supply. Native failure has no breaker fallback. Physical phone filming and consenting-teammate detection remain field checks.

## Native equipment OFF extension (CE-010)

The approved optional scope permits OFF through reviewed existing HA entities while retaining the one-room-master boundary. Inventory labels alone are non-executable. Admin-only connection/entity registration, strict shared contracts, room scope, CSRF/origin checks, bounded/rate-limited gateway operations and exact target resolution prevent arbitrary browser-supplied services/targets. Scripts/scenes/groups/locks/alarms and detected masters/protected loads are excluded.

HA tokens are write-only and encrypted with AES-256-GCM using random nonces, connection-bound AAD and a purpose-specific HKDF key derived from the server-only SESSION_SECRET outside MongoDB. Normal responses omit ciphertext/pins; logs/errors/audits do not echo tokens or raw upstream bodies. Rotating the root secret requires re-entering HA tokens; disconnecting does not revoke a token inside HA. URL changes require an authorised replacement token for a different origin.

Gateway destinations must match deployment-controlled exact origins; credentials in URLs, unexpected ports/paths, redirects, metadata/link-local and mapped-IPv6 bypasses are blocked. IPs are resolved/pinned on save, revalidated and injected into actual HTTP/WS socket lookup. HTTP is separately opt-in for trusted private LANs; loopback is separately disabled by default. TLS validation remains enabled. Overall request deadlines, bounded messages/responses, heartbeat and bounded reconnect backoff prevent unbounded gateway work.

Simulation makes zero live requests and cannot fall through to HA. Live native OFF additionally requires non-demo server enablement, a tested healthy connection with live permission, genuine live occupancy, reviewed exact ordinary target and explicit current-mode test before automatic permission. Changing/disconnecting/rebinding resets permissions and cancels work. The room-master physical gate stays disabled.

Persistent native jobs use leases, room locks, current revisions and fixed expiry. Outage backlog is not replayed; recovered dispatched work is read/reconciled rather than re-sent. Bookings/QR/overrides/new occupancy invalidate pending work. Unknown/unavailable/optimistic states never prove OFF, and already-dispatched cancellation remains unverified. Native failure never initiates breaker fallback; required native prerequisites block dependent room cutoff. Reported OFF is not independently measured consumption or savings.

The browser verification exposed an existing Socket.IO origin issue: same-origin polling can omit Origin. Such requests now require a configured Host and absent/same-origin fetch-site; provided origins must still match exactly. Application socket sessions/roles/room checks remain mandatory. Hostile origin/fetch-site regressions are covered.

## Building authentication safeguards (CE-018)

Building Join Codes use a query-excluded salted bcrypt verifier plus purpose-separated HMAC-SHA256 lookup with the server session secret. A partial unique lookup index ensures one building per active code. Strong constrained codes are required, never logged, echoed, retrieved or published in configuration/docs. Replacement/disabling requires an authenticated administrator, current role, Origin and CSRF; existing members retain access. Keep SESSION_SECRET stable; its rotation requires replacing code lookups, not account passwords/memberships.

Registration/rotation serialize under a persistent building mutex. A crashed holder fails closed for admissions/code changes while existing member sign-in remains available. Coordinated orphan-lock/provisioning recovery is in INSTITUTIONS.md. Invalid codes and duplicate codes create no identity. Accounts stay inactive until member persistence succeeds; caught failures roll back only new request-owned records. Cross-database writes are not a transaction.

Password hashing, email uniqueness, inactive-account denial, session regeneration, CSRF, role/room and socket isolation are retained. Viewer self-promotion and key-based login are removed. The server-only ADMIN_INVITE_KEY is checked with constant-time comparison solely before creating an empty Administrator building. Blank configuration disables that registration path without affecting existing-user sign-in. The key is never returned, embedded in client assets or logged. Historical admission/audit records remain. Login/selection/registration/code changes are throttled even on localhost/demo; shared distributed throttling and full recovery/lifecycle assessment remain production work. The actual .env is preserved. Explicit deployment values override file values; duplicate key entries are rejected without exposing values. The configured key never grants access to an existing building.

## Implemented safeguards and current limits

Implemented: bcrypt hashing, Mongo-backed HttpOnly/SameSite sessions with login regeneration, strict Zod input, exact-origin/CSRF mutation checks, role/room/service scope, login/lease/supply rate limits, bounded JSON/CSV parsing, redacted errors/audits, room locks, expiring explicit commands and durable deduplication. Configuration rejects placeholder secrets and all physical enablement because no commissioned adapter exists. Demo meter inputs remain simulated.

`npm run setup` generates ignored local secrets without printing them. No password/token is embedded in the UI or Markdown. Integration creation returns an HMAC-derived source-specific token to an authenticated admin; the root secret remains server-side. Source/type/room and timestamp checks prevent cross-source observation submission. Socket.IO reuses sessions and checks active accounts before payload-free refresh; room subscriptions are scoped.

Local development binds loopback. HTTPS/reverse-proxy deployment, credential rotation/revocation, shared production rate-limit storage, retention enforcement, dependency/security review and an institutional reporting contact remain deployment work. No video archive or public remote-URL analysis exists; the scoped phone demo retains only its latest private thumbnail for at most two minutes. Missing general transports return unavailable. A real phone/HTTPS installation has not been verified.

## Access and trust boundaries

The Node backend is the policy authority. Browsers, QR pages, camera processors and presence nodes must not independently authorise power changes. Enforce server-side role and room scope for API requests and Socket.IO subscriptions, including requests made directly without the UI.

| Role | Permitted scope from the plan |
| --- | --- |
| Administrator | Configure rooms, users, integrations, assignments, policies and approved control |
| HOD / second responder | Assigned department incidents and recommendations; permitted acknowledgement, resolution and snooze |
| First responder / technician | Assigned incidents, inspections and recorded actions/evidence |
| Teacher / authorised staff | Permitted room-access leases, extensions and overrides |
| Student / general viewer | Permitted information or approval requests; no default direct power-control privilege |
| Integration service | Its own mapped telemetry, using a separate scoped service credential |

Apply the detailed [role rules](PLAN.md#4-users-permissions-and-admin-controls) and [API boundaries](API.md). Hiding a button is insufficient authorisation. Public QR lookup returns minimal room/access-policy information; it must not expose controller credentials or full staff details. A GET request or page load must never switch power. A static QR URL can be shared and does not prove physical presence.

## Sessions, secrets and input handling

Implement the [planned security rules](PLAN.md#17-security-access-and-deployment-rules):

- Use HTTPS for a network-accessible installation, secure HttpOnly session cookies and server-side sessions. Store password hashes; the planned stack uses bcrypt and a MongoDB-backed session store.
- Validate mutation origins, protect cookie-authenticated mutations against CSRF and restrict cross-origin access to the configured frontend origin.
- Rate-limit login, QR lease creation and control commands. Validate contracts, uploaded file types/sizes and parsing limits.
- Keep camera, meter, controller, broker and SMTP credentials server-side in protected configuration or encrypted/referenced storage. Never put these secrets in browser code or `VITE` variables.
- Redact passwords, RTSP credentials and tokens from logs, audit exports and errors. Audit actors, policy changes, commands and outcomes without leaking secrets.
- Authenticate service/device ingestion separately from user sessions. Enforce source scope, event deduplication, replay protection and timestamp validation; submitted confidence or a zero person count cannot bypass backend checks.
- Allow only administrator-configured integration endpoints validated at the gateway. Public analysis requests must not accept arbitrary remote URLs or reach unintended internal services.

`.env.example` and `backend/src/config.js` implement the current environment contract; [PLAN.md's template](PLAN.md#181-environment-configuration-template) also describes future transports. Startup rejects short/placeholder secrets and physical enablement. SMTP/MQTT/vision currently remain unavailable even if optional credentials are filled. Production deployment has not been verified.

## Simulation isolation

Default to `DEMO_MODE=true`, `ALLOW_PHYSICAL_CONTROL=false` and `DEVICE_ADAPTER=simulator`. Enforce these settings on the server and gateway. Demonstration mode must prevent instantiation of real switching adapters, rather than relying on a warning banner.

Preserve `dataMode` through readings, observations, commands, charts and outcomes. Accelerated clocks, fixture observations and replayed clips must never authorise physical actions. Use test/in-app notification recipients and separate demo MQTT topics or a separate broker where needed. Never seed real staff email addresses into demonstrations. A simulated OFF remains simulated regardless of a reported output or verification field.

## Physical action and restoration

The agreed actuator is exactly one independently controlled Wi-Fi smart master breaker per controlled room. It switches that room's approved ordinary loads together. Inventory entries, cameras and LD2410/ESP32 presence nodes do not introduce per-appliance controls or a second mains actuator.

Start rooms in alert-only mode. Before enabling physical control, require the [commissioning checks](PLAN.md#115-connection-and-commissioning-steps) and [final eligibility checks](PLAN.md#153-final-command-eligibility). In particular:

- Confirm the correct room master, tested integration, fresh live evidence, current policy/deadline, healthy device and explicit room approval. Recheck after command-lock waits and invalidate stale work on new occupancy, bookings, QR leases or overrides.
- Block occupancy-driven OFF when occupancy is unknown. QR expiry without an occupancy source leaves occupancy unknown and defaults to a staff action. A separately accepted fixed-duration policy still requires its own approval, local override and all fault/essential-load interlocks.
- Approve every downstream load for shared cutoff. An incompatible load or an unconfirmed required AC stop procedure blocks the entire room cutoff and creates manual work. Invalidate a stop confirmation if the AC restarts or evidence becomes uncertain; respect restart delays.
- Keep cameras, sensors, gateway/network equipment and emergency/essential supplies outside routine cutoff. A qualified electrician must establish the feeder, retain appropriate downstream protection and commission the installation.
- Restore automatically only a supply deliberately disabled by this automation, subject to access policy, health and restart constraints. Never reset a fault trip or override maintenance lockout/manual isolation. Missing required interlock status blocks restoration unless an approved manual procedure establishes eligibility.
- Persist explicit ON/OFF commands with request IDs and expiry; do not use toggles or retain MQTT switching commands. Reject expired work after reconnection. Record transport acknowledgement separately from controller feedback and independent verification.

A building consumption anomaly cannot justify blind shutdown of a selected room. Building-meter readings and camera evidence do not establish unmetered room consumption or a definite cause.

## Footage, evidence and deployment

Use only institution-authorised footage. Process suitable footage locally and retain minimal occupancy metadata by default; facial recognition, identity recognition from video and attendance monitoring are excluded. Restrict stored evidence images and set a short configurable retention period. Record model version/licence and footage-use permission before distribution; model selection and licensing review remain pending.

Run the prototype locally first with a continuously running worker. A remote dashboard needs an authenticated outbound gateway connection to private cameras/controllers; do not expose raw CCTV ports or unrestricted device control publicly. Loss of communication suspends new central automatic commands. A printed QR and local-only presence detection do not provide a command path. See [deployment boundaries](ARCHITECTURE.md) and the [connectivity limits](PLAN.md#118-connectivity-limits).

Before a real deployment, the institution must supply authorised contacts, endpoint/credential details, retention settings, exact hardware/firmware documentation and commissioning approval. No security-reporting contact or disclosure process has been established in this repository. Security and failure validation is pending under [TESTING.md](TESTING.md).

All existing memberships, including the legacy institution, retain their roles. There is no password/key self-promotion path. An authorised administrator must change an existing role through role management; ADMIN_INVITE_KEY only gates creation of a separate empty Administrator building.

The client-secret scanner excludes only two exact, complete standard vendor encoding alphabets; a sequential numeric key can occur inside those public constants without being application configuration. It still rejects the configured credential literal everywhere else and scans the configured Administrator registration key without printing values. No secret values are printed.

CE-014 live updates retain active session/membership/admin verification and room scope before every socket feed batch. Recipient/admin filters apply to notifications and configuration. Events contain minimal invalidation identity/lifecycle metadata, not secrets/documents, and cannot invoke a control action. Permissions change clears room subscriptions; expiry/revocation disconnects. Reconnect snapshots and resource reads repeat ordinary HTTP authorisation. Cached results are bound to resource/institution identity and cleared on denied reads. No cross-tab channel grants membership or replaces server auth. Journal failures mark stale and snapshots repair delivery gaps; control safety remains backend-owned.

Dedicated cumulative meter OCR now has its own Meter cameras admin panel,paired phone source and bounded local Tesseract worker. Run npm run setup:ocr explicitly; normal startup never installs it. Manual review is the default; accepted values reuse energy imports/intervals,not occupancy or control. Images are admin-only and retained latest12 pairs/camera for24h; original OCR/correction metadata persists. Physical verification remains unverified and accuracy is not guaranteed. See [METER_CAMERA.md](METER_CAMERA.md) for setup,provenance,capture loss/reset procedures and remaining physical checks.
