# Database design and consistency

## Connected equipment extension (CE-010)

- `deviceConnections`: provider/mode, name, configured-origin instance fingerprint, validated origin/IP pins, excluded AES-GCM token ciphertext, enabled/live permission, configuration revision, REST/socket health, version/last-seen/error and audit actors. Normal API responses omit ciphertext and DNS pins; tokens are write-only.
- `connectedDevices`: immutable campus ID, connection/instance/entity/registry/physical identities and optional endpoint fingerprint, explicit campus room and optional existing inventory binding, capabilities/evidence, classification/review, manual/automatic permission, revisions, last observed provider state, explicit test evidence, verification and audit fields. Unique connection/entity; active physical identity/fingerprint and inventory indexes prevent ambiguous bindings where evidence exists. Rebinding resets permissions rather than guessing names.
- `nativeCommands`: unique request ID, exact resolved target/action OFF, room/connection/incident and actor, policy/device/connection revisions, issue/dispatch/accept/expiry times, status, mode, verification, before/after evidence and retained timeline. Accepted/unavailable is not confirmed OFF; late matching evidence may reconcile an unverified command without erasing its history.
- `simulatedEntities`: persistent isolated fixture state/outcome per simulator connection/entity; no live adapter fallback.
- Existing `jobs` adds kind, targetId, commandId, expiry and device/connection revisions. Native jobs are claimed separately from legacy alert/master jobs. Missing jobs reconcile from durable commands; expired/dispatched work is not blindly replayed.
- `rooms.nativeOffMode` defaults alert-only and is independent of master mode. `devices.nativeOffRequired` optionally blocks dependent master OFF until fresh matching native confirmation. Inventory alone remains non-executable. New occupancy, schedules, QR, overrides and policy changes cancel native intent through the existing room-work invalidation helper.

As elsewhere, this is at-least-once document/row persistence with conditional writes, unique indexes and compensation, not cross-collection transaction guarantees. Connection disablement is authoritative immediately; dependent permission/job cleanup completes before its API response returns. Source timestamps plus observed times order state writes across API/worker processes.

## Administrator setup extension (CE-009)

- Singleton `settings/installation` now stores organisationName, contactEmail, address, buildingType and setupCompleted alongside energy settings. No extra building/tenant collection is introduced.
- New `floors` records have stable UUIDs, unique code, editable name and order. Existing rooms retain their IDs and may remain unassigned until floorId is selected.
- `rooms` additionally stores floorId, spaceType and cameraConfiguration. Renaming/moving preserves QR token, schedules, evidence and master mapping. Generated rooms each receive a separate simulator master; failed bulk insertions clean up only their own newly generated IDs.
- `roomBreakers` adds editable name/manufacturer/model/nativeDeviceId/installationVerified metadata; metadata cannot enable physical transport or reset interlocks. Camera registration reuses `integrations` and scoped gateway authentication.
- Sessions include server-only adminVerified after password/key verification. Invalid signup keys never persist a viewer fallback. Password hashes and root secrets remain excluded from responses; admin activation and setup changes are audited.

**Status:** MongoDB/Mongoose schemas and indexes now exist in `backend/src/models/index.js`, with database/API verification. The catalogue follows [PLAN.md §14](PLAN.md#14-database-collections-and-consistency-rules). The additional `importBatches` collection stores durable preview/commit state. No production database deployment is claimed.

## Implemented storage conventions

- Documents use stable string `_id` values (UUID by default), UTC Mongoose timestamps and strict schemas. Relations use string room/source/actor IDs, validated by service routes.
- `settings` has singleton ID `installation`: timezone, tariffs, baseline thresholds, holidays, meter/epoch/register/supply-limit configuration and cost assumptions. Seed values are hypothetical.
- `roomBreakers.roomId`, `rooms.code`, `rooms.roomBreakerId` and public room tokens are unique. Room command leases (`commandLockOwner`/`commandLockUntil`) serialize policy/evidence/lease/command operations; those lock fields are omitted from responses.
- Observations are unique by sourceId/eventId. Meter identities include meter/epoch/register/mode/capture/kind and a canonical import key. Timetable import keys and notification keys are unique.
- `energyIntervals` persists boundaries, kWh, average kW, coverage, lineage and an embedded baseline/calculation version. `baselines` has a reserved schema/index; current calculations use the embedded record. Calculation implementation is version 1; fuller baseline history/version management remains future work.
- `importBatches` holds type, mode, creator, normalised rows, `rowErrors`, duplicate count, status, commit time and 24-hour expiry. API responses expose rowErrors as `errors`. TTL only cleans previews, never executes control deadlines.
- `notificationOutbox` is also the MVP inbox: recipient, stage, delivery state and readAt. `sessions` is managed by connect-mongo with its expiry index, not an application Mongoose model. No external provider delivery is claimed.
- Reading `corrections` preserve old/new value, actor, time and evidence reason. Normal-stop evidence retains actor/reason/time and is invalidated after restart or uncertain occupancy. Raw meter-image/OCR files, physical credentials and production retention enforcement remain pending. No identifiable footage is stored.

## Installation and ownership

Use one installation configuration for one college building and its selected rooms/common-area zones. Department labels and room permissions scope work within that installation; multi-building and tenant hierarchies are outside scope.

The Node backend validates writes and owns policy decisions. Python and hardware services submit scoped observations. Use stable string IDs at API boundaries, explicit energy/power units, and UTC persisted timestamps. The pilot's timetable and display timezone is `Asia/Kolkata`; local daily totals must use the appropriate local boundaries.

## Planned collections

The names and essential fields follow the plan. See source schemas for exact types/defaults; this table also retains intended optional-integration fields. Deployed schema/index changes require explicit migrations; seed performs no destructive reset.

| Collection | Purpose and essential data |
| --- | --- |
| `settings` | Installation name, timezone, tariff configuration, default policies and data mode. |
| `users` | Name, email, password hash, role, department label, permitted room IDs and active flag. |
| `rooms` | Code, name, `roomBreakerId`, known capacity, zone type, assignments, occupancy/shared-cutoff policies and `policyVersion`. |
| `roomBreakers` | Unique room ID, adapter/native device identity, feeder coverage, verified ratings, interlocks and supply state. |
| `devices` | Room, category, `ratedWatts`, `controlledByRoomBreakerId`, essential/standby flag, interruption approval and stop/restart rules. Load inventory only; no independent switching. |
| `integrations` | Source/adapter type, allowlisted endpoint, credential reference, capabilities, `lastSeenAt` and health. |
| `schedules` | Room, start/end, title, status, origin/import identity, timezone and cancellation details. |
| `observations` | Source/event IDs, room, capture/receipt times, occupancy/equipment evidence, quality and data mode. |
| `meterReadings` | Meter, epoch, kind/register, value/unit, time range, provenance and validation state. |
| `energyIntervals` | Start/end, kWh, average kW, coverage, source-reading IDs and calculation version. |
| `baselines` | Matching rule, expected range, sample count, training window and version. |
| `incidents` | Type, room/device or building-meter scope, active flag, evidence, lifecycle state, responder assignments and timestamps. |
| `jobs` | Incident/action, `dueAt`, `policyVersion`, status, lease owner/until and attempt count. |
| `notificationOutbox` | Incident/stage/recipient, channel, idempotency key, delivery state and provider response. |
| `accessLeases` | Room, requester, approved duration, server-controlled start/expiry, warning/extension state and policy acceptance. |
| `overrides` | Room/circuit, creator, scope, reason, start/end and cancellation. |
| `commands` | Request ID, target, explicit action, reason, issue/expiry time, transport result and verification. |
| `recommendations` | Pattern, evidence, proposed action, owner, estimate, status and outcome. |
| `auditEvents` | Actor/service, action, target, timestamp and redacted before/after values. |
| `sessions` | Server-side application session store. |

Record the AC/sensitive-load approval fields named in [PLAN.md §11.3](PLAN.md#113-ac-handling-without-ir-hardware): `supplyInterruptionApproved`, `requiresNormalStopBeforeCutoff`, `stopProcedureConfirmedAt`, `restartDelaySeconds`, `restartBehaviourKnown`, `essentialStandbyRequirement` and `approvalNotes`. Invalidate a normal-stop confirmation if the AC restarts or supporting evidence becomes uncertain.

## Mapping and room-state invariants

- Each controlled room maps to exactly one Wi-Fi smart master breaker; a master cannot serve two independently controlled rooms.
- Inventory records identify every downstream load. One incompatible load blocks the whole room cutoff. An inventory flag alone cannot physically exclude a load from the feeder.
- Camera, sensor, controller/network and emergency/essential supplies remain available outside the routine cutoff. Commissioned coverage and interlocks must be recorded before physical enablement.
- Store observed occupancy, authorised-use protection, controller-reported supply and appliance operating-state evidence separately. One does not establish another.

Observed occupancy is `occupied`, `vacant` or `unknown`. Any fresh credible positive signal protects the room. Vacancy requires validated coverage, a completed confirmation period and healthy/fresh required sources. Disagreement or inadequate coverage yields unknown unless fresh positive occupancy already establishes occupied. A zero person count is not sufficient by itself.

A timetable match, active QR lease or override protects authorised use. Lease expiry and timetable cancellation remove that protection without establishing vacancy. With no occupancy source, default physical QR expiry creates a staff confirmation task. Any opted-in fixed-duration policy has a separate command reason and approval/override rules.

## Meter lineage, validation and analytics

Use the contracts in [API.md](API.md) and [PLAN.md §6](PLAN.md#6-meter-ingestion-validation-and-calculations).

- Keep meter identity, register, unit, epoch, source, capture/receipt times and validation status with each reading. Retain OCR raw text, image reference and review/correction history where applicable.
- The backend decides `accepted`, `needs_review` or `rejected`; confidence does not bypass validation. Replacements, resets and rollovers require explicit epoch handling.
- Difference accepted cumulative readings only within a compatible meter epoch/register. Sum interval-energy inputs. Reconcile overlapping sources instead of adding duplicate representations of the same consumption.
- Calculate interval kWh and average kW using actual elapsed time. A reading gap produces an aggregate interval, not invented measured hourly points. Daily totals disclose coverage.
- Preserve `dataMode` and provenance in derived intervals, charts, recommendations and outcomes. Synthetic inputs remain simulated even if their CSV labels resemble real readings.
- Version baselines and calculations and retain source-reading IDs. Compare compatible durations/calendar/timetable context, with a configurable minimum sample count initially set to eight compatible valid historical intervals. Use a configured initial-rule baseline or an insufficient-data label when history is inadequate.
- Building-meter evidence does not establish unmetered room consumption or the cause of a spike. Room rated-load estimates remain estimates.

Recommendations retain evidence, owner, assumptions, kWh/rupee ranges, calculation period, cost, priority, due/follow-up dates and related incidents/actions. Separate estimated benefits, observed reductions and verified savings; avoid overlapping savings. Tariffs and payback assumptions follow [PLAN.md §8.3](PLAN.md#83-savings-and-roi-calculations).

## Required indexes and duplicate protection

Enforce these in the database, not just UI checks:

| Constraint/index | Purpose |
| --- | --- |
| Unique event ID per integration/source | Reject repeated observations or telemetry. |
| Unique room code | Stable room identity. |
| Unique room ID in `roomBreakers`, plus master identity/mapping enforcement | One active master per controlled room; no shared master across independent rooms. |
| Unique command request ID | Deduplicate command intent/retries. |
| Unique import identity per source record | Idempotent re-imports without doubled energy. |
| Unique notification stage/incident/recipient/channel key | Deduplicate escalation delivery intent. |
| Partial unique index for one active incident per defined issue key | Prevent parallel active episodes for the same issue. |
| `jobs` by status and `dueAt` | Find persisted due work. |
| `schedules` by room and start/end | Evaluate current/preparation-window protection. |
| `observations` by room/source and `capturedAt` | Evaluate room evidence and freshness. |
| Meter observations by meter/epoch/register/time | Retrieve compatible ordered readings. |

Implemented active issue keys are `vacancy:<roomId>`, `energy:<intervalId>` and `access_expired:<roomId>`, with unique partial filter `{active:true}`. Job IDs are `<incidentId>:first/second/final`. Reopening a room issue creates a new episode; recalculating the same energy interval does not reopen a resolved investigation. Duplicate events/imports/retries are not new incidents.

## Durable work and lifecycle

Use a separate Node worker and MongoDB-backed due jobs/outbox. Timing is based on persisted `dueAt`, with the first alert at t=0, second stage at +10 minutes, and final recheck after 15 additional minutes. The alert clock begins after confirmed vacancy and protection checks; the initial vacancy default is 15 minutes.

Persist the incident/work, claim jobs with atomic conditional updates and leases, reload current eligibility, cancel obsolete work, persist delivery/command intent, execute with deadlines and bounded retries, then save outcomes. Recover expired worker leases and reevaluate overdue work on restart. Policy changes, positive occupancy, bookings, QR leases and overrides invalidate stale OFF work.

Incident states follow [PLAN.md §15.2](PLAN.md#152-incident-lifecycle): `observing`, `open`, `notified_first`, `escalated`, `inspecting`, `snoozed`, `shutdown_pending`, `action_sent`, `action_unverified`, `resolved`, `cancelled`, `blocked` and `failed`. Acknowledgement alone is not resolution. Keep notification acceptance, delivery, read state and human acknowledgement distinct.

Store command verification separately from transport success. `simulated`, `command_only`, `controller_reported`, `independently_metered`, `manually_confirmed` and `unknown` are the plan's verification levels. Simulated data never establishes physical shutdown. Keep the reason a supply was opened so restoration can distinguish automation OFF from faults, manual isolation and maintenance.

Assume at-least-once processing. A single MVP worker still needs idempotency. Cross-collection atomicity requires supported transactions or an equivalent consistency design; it is not supplied by independent writes. A provider lacking idempotency can produce uncertain/duplicate notification delivery after a crash. Do not promise exactly-once physical execution.

TTL cleanup may remove expired sessions/observations according to retention policy. It must not execute escalation, QR-expiry or power-control deadlines. Browser countdowns and process-only timers are also insufficient.

## Retention and remaining design work

Store password hashes and protected/referenced integration secrets, redact credentials from audits, and restrict evidence-image access. Retain minimal occupancy metadata by default and define a short configurable image retention period; no fixed retention duration has been selected. See [SECURITY.md](SECURITY.md).

Meter/epoch configuration and holidays live in settings; public tokens in rooms; inbox state in notificationOutbox; previews in importBatches. Manual reading review is implemented; raw image/OCR review and production retention/migrations remain pending. Jobs reconcile partial writes; row/document idempotency and room leases are not transactions or exactly-once guarantees. Track work in [TASKS.md](TASKS.md) and verify through [TESTING.md](TESTING.md).
