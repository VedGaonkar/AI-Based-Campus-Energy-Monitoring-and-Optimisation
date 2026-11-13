# Security and Control Requirements

**Status:** Core local controls are implemented in `backend/src/app.js`, `security/access.js`, `config.js` and the room-master service, with API/policy tests. Optional integrations and production hardening remain pending. [PLAN.md](PLAN.md) is authoritative; requirements below still apply beyond the verified subset.

## Implemented safeguards and current limits

Implemented: bcrypt hashing, Mongo-backed HttpOnly/SameSite sessions with login regeneration, strict Zod input, exact-origin/CSRF mutation checks, role/room/service scope, login/lease/supply rate limits, bounded JSON/CSV parsing, redacted errors/audits, room locks, expiring explicit commands and durable deduplication. Configuration rejects placeholder secrets and all physical enablement because no commissioned adapter exists. Demo meter inputs remain simulated.

`npm run setup` generates ignored local secrets without printing them. No password/token is embedded in the UI or Markdown. Integration creation returns an HMAC-derived source-specific token to an authenticated admin; the root secret remains server-side. Source/type/room and timestamp checks prevent cross-source observation submission. Socket.IO reuses sessions and checks active accounts before payload-free refresh; room subscriptions are scoped.

Local development binds loopback. HTTPS/reverse-proxy deployment, credential rotation/revocation, shared production rate-limit storage, retention enforcement, dependency/security review and an institutional reporting contact remain deployment work. There is no video/image storage or public remote-URL analysis; missing transports return unavailable. A real phone/HTTPS installation has not been verified.

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
