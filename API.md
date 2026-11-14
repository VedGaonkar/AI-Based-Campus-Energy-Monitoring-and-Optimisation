# API and integration contracts

## Deployment session transport (CE-024)

Authenticated `GET /api/v1/sync/ticket` returns `{data:{syncTicket}}` with `Cache-Control: no-store`. The signed 60-second handshake token references the existing session and carries no roles/passwords; use only in Socket.IO auth, never URL/storage/logs. Exact allowed Origin, current MongoDB session, active account/membership and administrator verification are still required. Active sockets revalidate session/membership; logout or workspace changes revoke the old connection. Cookie-based same-origin sockets and phone-scoped pairing are preserved. For Vercel, proxy HTTP `/api/*` and `/assistant/*` to Render; connect real-time directly. See [deployment instructions](deployment/RENDER_VERCEL.md).

## Deployment and presenter integration (CE-021)

Canonical setup UI is direct `/presenter`, authenticated with existing Administrator membership and separate from product navigation/shell. Legacy `/phone-demo` is a direct compatibility alias; API paths under `/demo/sessions`, `/demo-phone` and `/meter-phone` are unchanged. Room/device registration remains in normal Management/API. Application HTTP CORS allows exactly `FRONTEND_ORIGIN` and the external `PUBLIC_APP_URL` origin with credentials; mutation CSRF/Origin checks still apply. `DEMO_PHONE_ORIGINS` grants bearer phone-route CORS and socket handshake eligibility, never app membership or general API CORS. Socket namespaces separately enforce current session/membership or scoped capability. Production origins reject HTTP, loopback, wildcards, credentials and paths. Optional `DEMO_CAMERA_APP_URL`/`DEMO_CLASSROOM_APP_URL` select complete trailing-slash, allowlisted frontend URLs for issued pairing fragments; these URLs are interfaces, not camera feed/control proof. Missing API/demo/build assets return404; SPA routes serve the main entry.

Main build public `VITE_API_ORIGIN`/`VITE_REALTIME_ORIGIN` and phone build `PHONE_API_ORIGIN`/`PHONE_REALTIME_ORIGIN` select the backend; blank means page origin, no production localhost fallback. API `HOST` defaults loopback locally and is explicitly0.0.0.0 in private Docker networking. Main sessions remain Strict/HttpOnly/Secure in production; separate main/API origins require same-site HTTPS domains, not arbitrary third-party cookie reliance. Embedded assistant disables the short read-data cache so each new request reads current authorised website snapshots; LLM response caching remains keyed to snapshot/history. No provider invocation is needed for direct reads. See [DEPLOYMENT.md](DEPLOYMENT.md).

## Optional sustainability reporting (CE-020)

All paths below have prefix `/api/v1/sustainability`, use existing authenticated immutable-building binding, CSRF/Origin on POST/PATCH, and strict input validation. No client role or institution ID is accepted. Module disabled by default; disabled calculations/records/reports return409. See [SUSTAINABILITY.md](SUSTAINABILITY.md) for formulae and evidence limitations.

| Method/path | Permission | Contract |
| --- | --- | --- |
| GET `/config` | Member | Enabled flag, thresholds, configured import meters, source-checked optional official factor metadata |
| PATCH `/config` | Admin | `{enabled,reductionThreshold,minimumCoverage}`; persists initial assumption once when enabling |
| GET `/factors` | Enabled member | Append-only version history including value/unit/geography/source/year/effective dates/status |
| POST `/factors` | Admin | Custom `{value,geography,source,reportingYear,effectiveFrom,effectiveTo,methodology}` always assumption; or exact `{officialIndiaFY2025:true}` source-checked CEA preset |
| GET `/records` | Enabled member | Approved evidence; Admin also pending/rejected |
| POST `/records` | Admin | `{kind:activity\|policy\|reporting,title,date,responsible,evidence,initiative?,students?,staff?,denominator?,countingMethod?,endAt?,reviewAt?}`; starts pending |
| POST `/records/:id/review` | Admin | `{status:approved\|rejected,note}`; append reviewer/time/note |
| POST `/preview` | Enabled member | Selection below; full transparent calculation, approved evidence, quality/gaps |
| GET `/reports` | Admin | Latest100 saved ESG report metadata |
| POST `/reports` | Admin | Same selection/calculator as preview; saves latest immutable snapshot in existing Report model |
| GET `/reports/:id/export` | Admin | Full saved JSON envelope attachment, no recalculation; cross-building IDs404 |

Selection: `{meterId,dataMode:live|simulated|replay,start,end,baselineStart,baselineEnd,occupancy?:unknown|similar|different,contextEvidence?:string}`. Dates require ISO8601 offset, displayed in UTC. Non-overlap, positive durations, max366 days/period; equal elapsed duration required to calculate reduction. Non-unknown occupancy needs at least10 characters of evidence. Energy source feed is explicitly bounded at20,000 readings/meter/mode before the latest endpoint; excess fails422, never truncates silently. Source reading units must be kWh and register import_kwh. Responses include methodology version, factor and source-reading snapshots, coverage, gap list, provisional warnings, formula denominators and governance rubric. Settings/factor/evidence changes and energy changes invalidate through the existing journal. Exports/writes are audited. No factor/report update/delete routes exist.

## Meter cameras (CE-016)

Admin GET/POST /meters selects/adds a configured cumulative meter. Admin GET/POST /meter-cameras and PATCH /meter-cameras/:id manage exact meter/epoch binding and validated interval/register/unit/ROI/orientation/decimal configuration. No URL feed input exists. POST /meter-cameras/:id/pairing returns one-time camera-only credentials. GET /meter-ocr/health runs the actual optional engine check. POST /meter-cameras/:id/test or POST /meter-images (cameraId required) accepts captureId,capturedAt,images (one/two bounded JPEG/PNG objects) and stores reviewable real OCR evidence; a test does not imply accepted energy.

Admin GET /meter-captures?cameraId=, GET /meter-captures/:id/images/:index and POST /meter-captures/:id/review (action accept|correct|reject,value?,reason) expose retained evidence and audited review. Original candidate/text/configuration are immutable; preview checks24h/latest12 retention. Auto acceptance is disabled by default and requires a clear matching reviewed two-frame test at the same revision. Failed/ambiguous candidates never reach accepted analytics. Existing /meter-readings/:id/review updates linked capture review values without replacing OCR evidence.

Separate /meter-phone/pair accepts the institution-qualified code; bearer /state?active=1 returns only its camera/current persisted capture request, POST /frames requires that jobId,captureId,capturedAt,images, and POST /offline reports camera stop. Exact allowed origins, token expiry/generation, input/rate limits and institution-bound models apply. It cannot authenticate occupancy or command routes. Capture intervals use wall time and expire; outage backlogs are not replayed. Admin GET/POST /meter-epoch-transitions records reset/replacement/rollover and revokes old source access. See [METER_CAMERA.md](METER_CAMERA.md) for contracts, dependency/setup and limitations.


## Scoped live updates (CE-014)

Authenticated GET /sync/snapshot returns { institutionId, revision, serverTime, degraded, user, reconcile }. This is a membership-checked reconciliation checkpoint: the frontend refetches every mounted page's existing authorised GET resources, not an unrestricted database dump. Cache-Control: no-store. Permission/session checks and room-scoped mutation rules remain unchanged. Clients never submit an institution ID to authorize this endpoint.

Root Socket.IO emits sync:change { eventId, institutionId, revision, resource, entityId?, roomId?, operation, phase?, verification?, at }. Payloads invalidate reads; they are not state replacements, notifications or permission grants. No documents, secret values, names, recipient IDs, thumbnails or command request bodies are broadcast. Resources cover rooms/floors/institution, inventory/master/native devices and commands, schedules, QR leases, overrides, incidents/acknowledgements, notifications, jobs, sources, energy and recommendations. Command phase and verification are separate: requested/pending/sent/accepted do not imply confirmed OFF; simulated/provider_reported_off/simulator_acknowledged retain their existing evidence meanings.

Socket handshake authenticates the session/current institution. Every feed batch reloads the session and verifies active account/membership/role/room scope. Room subscriptions additionally validate the room in that institution. Updates target the authorised institution and room; notifications target their recipient (admins retain existing inbox access). Admin-only configuration resources remain admin-only. Permission changes remove room subscriptions and emit sync:reset; revoked/expired sessions receive sync:revoked and disconnect. sync:heartbeat reports health/time without private change counts. sync:degraded marks delivery uncertain. sync:reset means refetch (initial connect/permission change), not replay successful commands.

Revisions are monotonic per operational database and event IDs are unique; duplicates/older/wrong-institution events are ignored. Reconnect/foreground refetch authorised snapshots and page resources. A 15s repair snapshot covers missed delivery, TTL expiry, time-derived protections and a process failure between operational write and journal append. No exactly-once or atomic cross-collection outbox claim is made. Persisted journal entries expire after 24h; there is no public event-history API or client-driven service execution. The legacy unconditional 3s refresh event is replaced.


## Building authentication contracts (CE-018)

All paths are relative to /api/v1. POST /auth/login accepts only {email,password}. One valid membership returns {user,institution,csrfToken}. Multiple memberships return {selectionRequired:true,workspaces:[{_id,displayName}],csrfToken} and a five-minute pending session without operational access. GET /auth/workspaces accepts only authenticated/pending identities. POST /auth/select-workspace {institutionId} rechecks the requested active membership, role and account; the ID is a selection hint, never authorization. The final session/CSRF token rotates.

POST /auth/register accepts {name,email,password,confirmPassword,accountType,joinCode}; institutionName and adminKey are used only for accountType=administrator and forbidden for viewer. The adminKey must match server ADMIN_INVITE_KEY; missing/incorrect keys return 403 INVALID_ADMIN_KEY before any account/building write. Missing server configuration returns 503 ADMIN_REGISTRATION_DISABLED. Password-only login rejects adminKey. Passwords require 6+ characters and matching confirmation. Codes require 8-64 ASCII letters/numbers/optional hyphen/underscore, letters and digits and six distinct characters. Administrator registration always creates a separate empty building; a code grants only Viewer. Strict schemas reject role/building IDs and obsolete fields; adminKey is accepted only for new Administrator registration. Invalid/disabled code returns 403 JOIN_CODE_INVALID, unavailable code 409 JOIN_CODE_UNAVAILABLE, duplicate email 409, invalid shape 400. Registration is limited to 20 attempts/IP/15 minutes, login/selection to 30, including localhost/demo.

GET /institutions/current returns {_id,displayName,demo,joinCodeEnabled}. Admin PATCH /institutions/current {displayName} preserves IDs. Admin PUT /institutions/current/join-code accepts {joinCode} to replace/enable or {enabled:false} to disable, and returns only {joinCodeEnabled}. No plaintext code/verifier/lookup is returned. Rotation/disabling/rename retain existing members. Persisted registration/rotation mutual exclusion can return 503 JOIN_CODE_BUSY; crash recovery is in INSTITUTIONS.md.

GET /institutions/suggestions, POST /institutions/resolve, POST /auth/accept-invitation, POST /institutions/current/access-code and POST /institutions/current/invitations are retired (410). Historical records are retained. The production server uses the workspace directory. Legacy single-database test harnesses support existing-user login but reject registration with 410 WORKSPACE_REGISTRATION_REQUIRED.

Operational databases, roles, room scopes, socket subscriptions, source ingestion and public capabilities retain their existing membership isolation. A query/body building ID cannot override trusted request context.

## Two-phone demonstration (CE-011)

`GET /demo/available-rooms` is admin-only and returns room `_id`, code, name and unavailableReason (null when available). Shared checks cover existing session/native policy, mapped simulator, health/interlocks, independent infrastructure and reviewed load inventory; missing legacy nativeOffMode defaults to alert_only. Session creation rechecks the same rules under its room lock. Availability is setup eligibility, not permission to bypass current occupancy/booking/QR/override or command-time checks.

Paths are relative to `/api/v1`. Existing key-verified admin sessions, room scope and CSRF/origin checks protect `/demo/sessions`. Phone routes use one-use pairing and scoped expiring bearer capabilities with exact allowed mutation origins. No administrator or HA credential is exposed. See [DEMO_SETUP.md](DEMO_SETUP.md) and `shared/phone-demo-contracts.js`.

| Method/path | Contract |
| --- | --- |
| `GET/POST /demo/sessions` | Admin list/create: roomId, visionMode instrumented/camera_inference/scenario_injection, coverageReviewed:true, vacancyConfirmationSeconds (2–60), durationMinutes (5–120), optional allowManualControl. No inventory approvals/protected use changed. |
| `GET /demo/sessions/:id` | Scoped admin evidence/protections/phone health, persistent incidents/jobs and command/ACK history; no secrets or thumbnail bytes. |
| `POST /demo/sessions/:id/pairing` | Admin issues camera/classroom/presenter code plus fragment URL/QR once; five-minute validity; replaces prior role capability. |
| `POST /demo/sessions/:id/stop` or `/reset` | Revoke pairings, cancel work/subscriptions, restore owned room configuration. Reset requires new pairing; no automatic energisation. |
| `GET /demo/sessions/:id/frame` | Admin-only current JPEG thumbnail; no-store, two-minute expiry, cleared on end. |
| `POST /demo-phone/pair` | `{code}` → expiring role/session/room token. One use; cookies/root credentials not required. |
| `GET /demo-phone/state` | Capability-scoped snapshot; camera role does not receive classroom marker/scenario. |
| `POST /demo-phone/frames` | Camera: sequence, capturedAt, mime, base64 image; JPEG/PNG ≤250KB, ≤960×720, capture ±5s, increasing sequence, bounded processing. Actual Python pixels; no URLs. |
| `POST /demo-phone/scene` | Classroom/presenter: allowlisted name, optional localSwitches/lock. Scene selection alone never creates a camera observation. |
| `GET /demo-phone/commands` | Classroom only receives current unexpired explicit ON/OFF; policy rechecked before delivery. Other roles receive no commands. |
| `POST /demo-phone/ack` | Classroom: commandId, matching action, applied:true. Current session/room/deadline/policy/interlocks checked; durable supply changes only after ACK. |
| `POST /demo-phone/master` | Opted-in classroom/presenter: UUID requestId + explicit action, using existing supply policy. No toggle/live provider. |
| `POST /demo-phone/inject` | Injection sessions only: occupancy + equipmentOn, source scenario_injection. Frames rejected in this mode. |
| `POST /demo-phone/offline` | Stop/background notification; camera unavailable, automatic cutoff cancelled. |

Existing Socket.IO adds `/demo-phone`, authenticated by handshake `auth.token`, isolated by session/role. `demo:state` carries the scoped snapshot; `demo:command` goes only to its classroom; clients send `demo:heartbeat`. Grants are rechecked; reconnect resynchronises state and ignores expired work. HTTP polling recovers transport, not scheduling. Lifecycle: pending/created → sent → completed with verification simulator_acknowledged, or cancelled/expired/unverified. All remain simulated. ACK is separate from later camera evidence. Python is a bounded local JSON-lines subprocess, not a public general vision HTTP service.

## Existing smart equipment / Home Assistant (CE-010)

All paths below are relative to `/api/v1`. Gateway setup/discovery/review/permission actions are admin-only. Device reads, refresh and commands require room scope; manual OFF additionally requires admin/HOD/technician. Writes retain CSRF/origin checks. Inputs in `shared/native-contracts.js` are strict; the frontend supplies an internal device ID and approved OFF request, never an arbitrary HA URL/domain/service/body.

| Method/path | Behavior |
| --- | --- |
| `GET/POST /device-connections` | List safe metadata / create simulator or allowlisted HA connection; token write-only |
| `PATCH /device-connections/:id` | Update name/URL/token or enabled flag; reset target permissions/tests and cancel work |
| `POST /device-connections/:id/test` | Read-only authentication/health/version test |
| `GET /device-connections/:id/entities` | Filtered state/capability/registry candidates; no command |
| `POST /device-connections/:id/live-permission` | `{enabled}`; live gate requires non-demo server approval and tested healthy gateway |
| `POST /device-connections/:id/simulation` | Demo-only exact fixture entity state/outcome; never live |
| `GET/POST /connected-devices` | Room-scoped list / authenticated entity registration and explicit room/inventory binding |
| `GET /connected-devices/:id` | Scoped details, state and review evidence |
| `POST /connected-devices/:id/refresh` | Authenticated state/capability read and identity check |
| `PATCH /connected-devices/:id/binding` | Explicit exact entity/room/inventory reconciliation; review/test permissions reset |
| `PATCH /connected-devices/:id/review` | Classification, identity/capability review, manual test permission and notes; automatic permission/test reset |
| `POST /connected-devices/:id/automation` | `{enabled}`; confirmed explicit current-mode/configuration test required |
| `POST /connected-devices/:id/off` | `{requestId,action:"off",confirmed:true}`; durable command/job; returns 202 requested, not a physical-success claim |
| `GET /connected-devices/:id/commands` | Scoped retained lifecycle/evidence history |
| `POST /connected-devices/:id/unregister` | Disable target/cancel work; retain history |

Provider errors are normalised AUTHENTICATION, AUTHORIZATION, UNSUPPORTED, UNAVAILABLE, RATE_LIMITED, TIMEOUT, TRANSPORT, DESTINATION, RESPONSE_LIMIT or IDENTITY_CHANGED; upstream bodies/tokens are never echoed. Gateway operations/control are rate-limited; routine safe metadata polling is separate. The simulator shares the provider interface without network requests. See [HOME_ASSISTANT.md](HOME_ASSISTANT.md) for gates, protocol/source versions and live prerequisites.

## Administrator authentication and management (CE-009)

Authentication follows CE-018 above. Admin proof records successful password authentication and the selected current role. A database role change alone cannot upgrade an existing session; profile/login cannot self-promote. Existing management permissions remain.

| Method/path (relative to `/api/v1`) | Implemented behavior |
| --- | --- |
| `PATCH /auth/profile` | Update own display name only; role/password fields rejected |
| `GET /management/building` | Admin-only singleton building, ordered floors and space registry |
| `PUT /management/building` | Persist organisationName, installationName, contactEmail, address, buildingType and initial-setup flag |
| `POST /management/floors` | Add floor with UUID, unique code, display name and order |
| `PATCH /management/floors/:id` | Rename/reorder without changing room relationships |
| `POST /management/floors/generate` | Add 1–30 next available numbered floors; preserve existing records |
| `POST /management/floors/:id/spaces` | Generate 1–100 spaces and unique simulator masters using count/prefix/startNumber/spaceType/capacity; reject overlapping codes |
| `POST /management/cameras` | Map named simulation/gateway camera to room; return `{integration,serviceToken?}`; gateway token returned once, never in list reads |
| `GET /management/controllers` | Existing one-room master mappings and reported simulator state |
| `PATCH /management/controllers/:id` | Update name/manufacturer/model/nativeDeviceId/installationVerified metadata; cannot change room mapping or adapter |
| `POST /management/controllers/:id/test` | Simulator status; no claimed physical network test |
| `GET /management/automation` | Occupancy, protected use, supply/policy/interlocks, pending jobs, commands and escalation timing |

Room create/PATCH additionally validates floorId, spaceType and cameraConfiguration (`installed`, `planned`, `none`, `offline`). Unavailable/no-camera choices invalidate camera coverage and obsolete vacancy work; camera evidence does not establish occupancy for a room explicitly configured without an available camera. Presence evidence and timetable/QR protection remain separate. `/management` routes require a verified admin session and origin/CSRF checks for writes. Existing timetable, QR, command, audit, inventory and user APIs remain authoritative.

**Status:** The local Express application implements the core routes below in `backend/src/app.js`, with inputs in `shared/contracts.js`. Physical device ingestion remains unavailable. Registered meter-image OCR uses the optional local engine; missing dependencies return an actionable error without invented readings. Python internal endpoints and native MQTT/vendor protocols remain planned. [PLAN.md](PLAN.md) is authoritative; no OpenAPI artifact or physical integration is claimed.

## Implemented HTTP conventions

- Successful responses use `{ "data": ... }`; string MongoDB identifiers are exposed as `_id`. Errors use `{ "error": { "code", "message", "requestId", "details"? } }`. `X-Request-Id` is returned on every response. Validation is `400`, authentication `401`, permission/origin/CSRF `403`, missing resources `404`, conflicts/interlocks `409`, oversized JSON `413`, unavailable integration `503`. Unhandled failures return redacted `500` errors.
- `GET /api/v1/auth/csrf` establishes a session and returns data.csrfToken. Mutations require configured Origin, cookie and X-CSRF-Token, including login/logout. Password authentication/authorised selection rotate the session. GET /auth/me returns server-verified user and CSRF token. Login/registration remain throttled; ingestion uses its separate boundary below.
- List responses are arrays in `data`; supported lists accept a bounded `limit` (default 100, maximum 200). Charts return up to 1,500 original intervals. Cursor pagination is not implemented.
- Room create accepts code, name, roomBreakerId and optional fields from the strict room contract. Defaults are alert-only/unvalidated. Inventory writes never operate an individual appliance. A room/master remap cannot silently replace a current mapping.
- Meter POST accepts the PLAN event contract plus optional `epoch` (default `initial`) and `intervalStart` for interval input. Returns `{reading,duplicate}`. Configured meter/epoch, original time, supply growth and quality determine acceptance/review. Demo mode forces supplied readings to `simulated`.
- Import POST accepts `{csv,dataMode}` and returns a persisted preview with `_id`, normalised `rows`, `errors` and duplicate count. `POST /imports/:id/commit` commits the creator's valid preview; invalid rows block commit. Repeated records/commits are idempotent. A commit can partially persist before a failure; retry reconciles row identities.
- Supply POST accepts `{requestId,action,reason:"staff_override",expiresAt?}` and returns a persisted command. Automatic/QR reasons are generated internally. Request IDs cannot be reused for a different actor/room/action/reason. Commands expire within one minute and require current interlocks. Only simulated results are possible.
- Lease create/extend accepts `{durationMinutes,acceptedPolicy:true}`; duration is capped at 120 policy minutes. Server-controlled lease time is accelerated only in demo mode. An extension is a new duration from now after booking/hour checks. Ending/extension is limited to the requester or admin and room scope.

The unit/API tests exercise these contracts against MongoDB; see TESTING.md for exact coverage.

## Additional implemented workflow routes

All paths below are relative to `/api/v1` and remain subject to role and room scope:

| Method/path | Contract |
| --- | --- |
| `GET /auth/csrf` | Obtain session CSRF token; does not switch supply |
| `POST /imports/:id/commit` | Commit a valid persistent preview created by the authenticated admin |
| `GET/POST /users` | Admin account creation: name, email, password (minimum 6), role and permittedRoomIds; password never returned |
| `POST /incidents/:id/inspect` | Record inspection without resolving |
| `POST /incidents/:id/reassign` | Admin assigns validated first/second responder IDs |
| `POST /recommendations/:id/schedule` | Accepted recommendation plus ISO `dueAt` |
| `POST /recommendations/:id/verify` | Completed recommendation plus evidence `reason` and optional observedReductionKwh; stores staff-reviewed outcome, not certified savings |
| `GET /notifications`; `POST /notifications/:id/read` | Persisted in-app inbox/read state; reading is not incident resolution |
| `GET /rooms/:id/qr` | Staff-only opaque access URL and QR PNG data URL; no switching |
| `PATCH /meter-readings/:id/review` | Responder supplies confirmed value and evidence reason; validates neighbors/supply bound, preserves source/mode and correction history |
| `POST /devices/:id/confirm-stop` | Room-scoped responder records reason/actor/time for an existing required stop procedure; it does not operate an appliance |
| `POST /integrations` | Admin maps source ID/type/room, coverage/freshness and optional meterId; returns a source-scoped service token once |

Recommendation states implemented: `proposed → accepted → scheduled/completed → reviewed`; rejection requires a reason. Proposed recommendations become `withdrawn` if recalculated evidence no longer supports the pattern. Inspection/acknowledgement remains unresolved. Snooze accepts 1–30 policy minutes; manual resolution requires evidence text. Assignment snapshots are retained until explicit reassignment. PATCH parsing retains only explicitly supplied fields; omitted defaults cannot reset safety metadata or resurrect a cancelled booking.

## Application boundary

All application routes use the `/api/v1` prefix. The paths in the table below are relative to that prefix. Use stable string IDs, explicit units, ISO 8601 timestamps, schema validation and standard error responses. Persist timestamps in UTC; interpret the pilot's calendar/display in `Asia/Kolkata`.

The Node backend owns authentication, room scope, policy decisions, ingestion acceptance, jobs and commands. The browser submits requests to it. Python inference and hardware adapters supply evidence or results; neither owns switching policy.

Apply server-side role and room checks to mutations and Socket.IO subscriptions. Use scoped service credentials for ingestion. A public QR lookup exposes only minimal room/access-policy information. Creating, extending or ending a lease requires authenticated authorisation; GET/page load must not switch power. See [SECURITY.md](SECURITY.md).

## Application routes from the plan

The methods and paths follow [PLAN.md §13.1](PLAN.md#131-application-endpoints).

| Area | Methods and paths, relative to `/api/v1` |
| --- | --- |
| Authentication | `POST /auth/login`; `POST /auth/logout`; `GET /auth/me` |
| Installation settings | `GET/PATCH /settings` |
| Rooms | `GET/POST /rooms`; `GET/PATCH /rooms/:id`; `GET /rooms/:id/status` |
| Load inventory | `GET/POST /devices`; `PATCH /devices/:id` |
| Assignments | `GET/PATCH /rooms/:id/assignments` |
| Timetable | `GET/POST /schedules`; `PATCH /schedules/:id`; `POST /imports/timetable` |
| Utility data | `POST /imports/meter-readings`; `POST /meter-readings`; `GET /meter-readings`; `POST /meter-images` |
| Analytics | `GET /analytics/summary`; `GET /analytics/intervals`; `GET /analytics/anomalies` |
| Incidents | `GET /incidents`; `GET /incidents/:id`; `POST /incidents/:id/acknowledge`; `POST /incidents/:id/snooze`; `POST /incidents/:id/resolve` |
| Recommendations | `GET /recommendations`; `POST /recommendations/:id/accept`; `POST /recommendations/:id/reject`; `POST /recommendations/:id/complete` |
| QR access | `GET /access/:publicToken`; `POST /rooms/:id/access-leases`; `POST /access-leases/:id/extend`; `POST /access-leases/:id/end` |
| Overrides | `POST /rooms/:id/overrides`; `POST /overrides/:id/end` |
| Integrations | `GET /integrations`; `POST /integrations/:id/test`; `PATCH /integrations/:id` |
| Commands | `POST /rooms/:id/supply-commands`; `GET /commands/:id` |
| Service ingestion | `POST /ingest/observations`; `POST /ingest/device-events`; `POST /ingest/meter-readings` |
| Operations | `GET /health`; `GET /ready`; `GET /audit-events` |
| Isolated demonstration only | `POST /demo/scenarios/:id/start`; `POST /demo/reset` |

`devices` represents observed equipment and downstream load inventory. It does not expose individual light, fan, socket or AC switching. Supply requests target exactly one room master breaker.

## Imports and event validation

The exact CSV examples live in [PLAN.md §6.4](PLAN.md#64-import-contracts) and executable examples are under `fixtures/`. Preserve these headers:

| Input format | Header |
| --- | --- |
| Cumulative meter reading | `meterId,capturedAt,readingKwh,register,source` |
| Interval energy | `meterId,intervalStart,intervalEnd,energyKwh` |
| Timetable | `roomCode,startAt,endAt,title,status` |

Preview invalid/duplicate rows, timezone assumptions, meter epoch, format type and intended source before committing. Re-importing the same records must be idempotent. The CSV `source` field and the JSON event `sourceType` field belong to different input contracts and must be normalised explicitly. A user-supplied source label does not make synthetic data measured evidence.

| Event | Fields and acceptance rules |
| --- | --- |
| Occupancy observation | `eventId`, `sourceId`, `roomId`, `capturedAt`, `sourceType`, `occupancy`, `detectedPeople`, `confidence`, `coverageValidated`, `quality`, `dataMode`, `modelVersion`; see [§13.2](PLAN.md#132-occupancy-observation-contract). |
| Meter reading | `eventId`, `meterId`, `capturedAt`, `kind`, `register`, `value`, `unit`, `sourceType`, `dataMode`, `quality`; see [§13.3](PLAN.md#133-meter-reading-contract). |

Occupancy values are `occupied`, `vacant` and `unknown`. The server computes freshness and room state from validated coverage and source health. A count of zero, expired access lease or cancelled booking cannot establish vacancy. Any fresh credible positive occupancy protects the room.

The backend assigns meter validation status `accepted`, `needs_review` or `rejected`. Validate register, units, decimal placement, capture chronology, physically plausible growth for the supply, duplicate identity and meter epoch. OCR confidence alone cannot authorise acceptance. Corrections retain provenance and an audit trail. Only accepted readings contribute to measured calculations; fixtures retain their simulated status. See [DATABASE.md](DATABASE.md) for interval and consistency rules.

## Commands and verification

Follow the payload examples in [PLAN.md §13.4](PLAN.md#134-device-command-contract). A command includes `requestId`, `roomId`, `roomBreakerId`, explicit `action` (`on` or `off`), `reason`, relevant `incidentId`, `policyVersion` and `expiresAt`. The backend/gateway adds `issuedAt` and the authorised actor and persists the command before transport. Do not use toggle commands.

Before dispatch, reload current evidence, schedules, QR leases, overrides, policy version, adapter health and interlocks, including after acquiring a command lock. Apply all [final eligibility checks](PLAN.md#153-final-command-eligibility). An incompatible downstream load blocks the whole room cutoff. Automatically restore only a supply deliberately opened by this automation, subject to access, restart and safety checks; fault trips, maintenance locks and manual isolation block restoration.

Results carry `requestId`, `transportStatus`, `reportedOutput`, `verification`, `verifiedAt` and `dataMode`. Verification levels are `simulated`, `command_only`, `controller_reported`, `independently_metered`, `manually_confirmed` and `unknown`. Missing feedback leaves an action unverified. Acknowledged transport does not establish physical shutdown. `dataMode: simulated` always remains simulated, including the plan's example with `verification: controller_reported`.

`DEMO_MODE=true` prevents real switching adapters from being instantiated; `ALLOW_PHYSICAL_CONTROL=false` is the initial physical-control setting. Accelerated time, replayed clips and fixture observations cannot authorise physical action. These controls belong on the server and gateway.

## Internal integrations

The optional Python service uses the separate paths in [PLAN.md §12.3](PLAN.md#123-internal-endpoints); they are not application routes under `/api/v1`:

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Service/model availability |
| `POST /v1/observe-frame` | Analyse a bounded frame and configured regions |
| `POST /v1/ocr-meter` | Analyse a bounded meter image |
| `POST /v1/sources/:id/start` | Start an administrator-configured source |
| `POST /v1/sources/:id/stop` | Stop that source |

Results include `sourceId`, `capturedAt`, `processedAt`, `modelVersion`, `dataMode` and quality. Source addresses are configured by an administrator and validated on the gateway; public requests cannot supply arbitrary camera URLs. Report missing models/integrations as unavailable, with a labelled replay/fixture alternative.

The room-master simulator and supported physical adapters share the [internal adapter contract](PLAN.md#116-room-master-adapter-contract):

```text
getCapabilities(roomBreakerId)
getStatus(roomBreakerId)
setSupply(roomBreakerId, on, requestId, expiresAt)
getCommandResult(requestId)
```

These functions are application contracts, not universal manufacturer endpoints. The internal simulator's `setSupply` service receives room ID, command input and actor to enforce mapping/policy before applying the contract. Exact physical model, firmware, protocol and feedback remain unavailable. Connection-test responses explicitly distinguish recent fixture observations from real integration availability.

Optional private MQTT topics follow [PLAN.md §13.5](PLAN.md#135-application-mqtt-topics). Commands and results are not retained. Retained presence keeps its original timestamp and must pass freshness checks. Deduplicate QoS 1 deliveries using stable event/request IDs, enforce per-device access and reject expired commands after reconnection. Socket.IO is for authorised application updates; event names and payload schemas remain to be defined.

## Contract work still required

Schemas and HTTP envelopes for implemented inputs now exist. Socket.IO uses the session cookie, validates source origin and active accounts, accepts a checked `subscribe-room` request, and emits a payload-free `refresh` signal with server time every three seconds. Room state is retrieved through scoped HTTP routes; it is not broadcast globally. Account/session state is rechecked before refresh. Native MQTT events, cursor pagination and a generated OpenAPI contract remain pending.

Service observation ingestion requires `X-Source-Id` and `Authorization: Bearer <source-specific token>`. Tokens are derived server-side with HMAC from the protected root secret and source ID. Source/type/room, five-minute timestamp bounds and uniqueness are checked. Repeated identical evidence returns the stored event; conflicting occupancy/mode/time for the same event ID is rejected. Replay remains isolated to demo mode. Native device events are unavailable; meter telemetry requires a registered meter scope. Manual meter correction is implemented; dedicated bounded meter OCR is implemented, while physical-camera commissioning, full account lifecycle and other external transports remain pending. Track work in [TASKS.md](TASKS.md), with evidence in [TESTING.md](TESTING.md).

CE-014 checked current official documentation through Context7 on14 November2026: Mongoose9.12.1 post document/query/model middleware (https://mongoosejs.com/docs/middleware.html); Socket.IO4.8.4 ordering/at-most-once delivery and unload lifecycle (https://socket.io/docs/v4/delivery-guarantees/ and https://socket.io/docs/v4/client-options/). Existing pinned dependencies retained; no added package. The browser harness uses documented Chrome DevTools Protocol page targets/offline/foreground commands; its legacy network-emulation command is still supported by installed Chrome but deprecated upstream.



## CE-017 analytics presentation and refresh

`GET /analytics/intervals` retains the existing workspace-authorised newest-1,500 interval contract (returned ascending by start time), enriched with `sourceTypes`, resolved from linked meter-reading IDs. Missing provenance returns an empty list; no camera configuration, OCR image or credentials are exposed. This is response enrichment, not a schema migration. Baseline `expectedKwh` drives chart comparison; `thresholdKwh` and `anomalous` continue to drive the existing anomaly policy. No threshold changes were made.

After `refreshAnalytics` completes all interval/anomaly/recommendation reconciliation, it publishes an `energy/recalculated` invalidation through the existing institution journal. This repairs the race where the reading-write invalidation could precede computed intervals. The same HTTP snapshot cache, reconnect repair and ordering/abort guards refresh cards, charts and open details. Non-atomic journal/recalculation and periodic repair limitations still apply.

Detailed consumption is a client view of these authorised records. Range/source filters, original resolution, totals and local CSV export use the same pure calculation helper; no new export endpoint/role bypass was introduced. Custom date/time bounds include whole intervals only, without prorating energy. Related incidents/recommendations retain their existing endpoint permissions and result bounds. Default source selection separates meter/data mode; explicit combined views retain provenance and must not be interpreted as an independently metered live total.

The Administrator form labels its chosen code **Set Building Join Code** and includes **Administrator registration key**. Viewer registration keeps **Building Join Code** and never submits adminKey. Sign-in remains email/password only.

### Session bootstrap and revised minimums

GET /auth/session returns {user:null,workspaces:[],csrfToken} for an anonymous caller with Cache-Control:no-store. It returns only the current verified user or a pending password-authenticated account's authorised workspace choices; it never publicly enumerates buildings. The frontend uses this cancellable bootstrap instead of calling authenticated endpoints while signed out. GET /auth/me, GET /auth/workspaces and operational routes remain protected. Logout destroys the stored session and clears its cookie; the API wrapper discards its CSRF token. The next bootstrap/login establishes a fresh session. Pending workspace selection survives page reload within its five-minute limit.

New-account and administrator-created staff passwords require at least 6 characters. Building Join Codes require at least 8 characters with existing allowed characters and composition checks; the same rules apply in forms and backend schemas. Existing password hashes are not rewritten. Validation errors are displayed with field labels rather than a generic 400 message.

## Embedded assistant (CE-019)

The existing assistant is mounted under `/assistant` after the website's session middleware. GET `/assistant/chat`, `/assistant/chat.js` and `/assistant/chat.css` require an active account/membership. `/assistant/api/session`, `/message`, `/confirm`, `/cancel` and other assistant API routes use the original assistant contracts with that prefix. Every call revalidates the website user and forwards data reads/writes only through existing authenticated website HTTP APIs. Mutations require a configured website Origin and the existing CSRF token; non-admin confirmation stays forbidden. `req.assistantSession` holds assistant identity without replacing express-session's `req.session`. Session/cookie secrets and Gemini keys are never returned.

Each immutable building gets a separate cached runtime/SQLite store; user browser-history identity includes building and user, and changing buildings recreates the frame. Cross-building proposals/announcements are inaccessible. Anonymous endpoints return 401, and website logout revokes assistant access. Relative assets/API requests work at the same prefix in development and production. The Vite proxy forwards `/assistant` to the existing API; no open proxy or new external origin is introduced.
