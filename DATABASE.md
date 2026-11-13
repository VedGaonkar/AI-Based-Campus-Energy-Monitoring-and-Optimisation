# Database design and consistency

**Status:** Planned MongoDB/Mongoose design. No application schemas, indexes, seed data, database configuration or worker have been implemented in this repository. The collection catalogue and rules below derive from [PLAN.md §14](PLAN.md#14-database-collections-and-consistency-rules); they are not evidence of an existing database.

## Installation and ownership

Use one installation configuration for one college building and its selected rooms/common-area zones. Department labels and room permissions scope work within that installation; multi-building and tenant hierarchies are outside scope.

The Node backend validates writes and owns policy decisions. Python and hardware services submit scoped observations. Use stable string IDs at API boundaries, explicit energy/power units, and UTC persisted timestamps. The pilot's timetable and display timezone is `Asia/Kolkata`; local daily totals must use the appropriate local boundaries.

## Planned collections

The names and essential fields follow the plan. Concrete schemas, optional/required field definitions and migrations remain implementation work.

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

The precise compound keys, active-issue key and partial-filter definition remain to be designed with the schemas. Reopening an issue creates a new episode and timeline. Do not treat a duplicate import, MQTT delivery or worker retry as a new incident.

## Durable work and lifecycle

Use a separate Node worker and MongoDB-backed due jobs/outbox. Timing is based on persisted `dueAt`, with the first alert at t=0, second stage at +10 minutes, and final recheck after 15 additional minutes. The alert clock begins after confirmed vacancy and protection checks; the initial vacancy default is 15 minutes.

Persist the incident/work, claim jobs with atomic conditional updates and leases, reload current eligibility, cancel obsolete work, persist delivery/command intent, execute with deadlines and bounded retries, then save outcomes. Recover expired worker leases and reevaluate overdue work on restart. Policy changes, positive occupancy, bookings, QR leases and overrides invalidate stale OFF work.

Incident states follow [PLAN.md §15.2](PLAN.md#152-incident-lifecycle): `observing`, `open`, `notified_first`, `escalated`, `inspecting`, `snoozed`, `shutdown_pending`, `action_sent`, `action_unverified`, `resolved`, `cancelled`, `blocked` and `failed`. Acknowledgement alone is not resolution. Keep notification acceptance, delivery, read state and human acknowledgement distinct.

Store command verification separately from transport success. `simulated`, `command_only`, `controller_reported`, `independently_metered`, `manually_confirmed` and `unknown` are the plan's verification levels. Simulated data never establishes physical shutdown. Keep the reason a supply was opened so restoration can distinguish automation OFF from faults, manual isolation and maintenance.

Assume at-least-once processing. A single MVP worker still needs idempotency. Cross-collection atomicity requires supported transactions or an equivalent consistency design; it is not supplied by independent writes. A provider lacking idempotency can produce uncertain/duplicate notification delivery after a crash. Do not promise exactly-once physical execution.

TTL cleanup may remove expired sessions/observations according to retention policy. It must not execute escalation, QR-expiry or power-control deadlines. Browser countdowns and process-only timers are also insufficient.

## Retention and remaining design work

Store password hashes and protected/referenced integration secrets, redact credentials from audits, and restrict evidence-image access. Retain minimal occupancy metadata by default and define a short configurable image retention period; no fixed retention duration has been selected. See [SECURITY.md](SECURITY.md).

The plan does not specify every schema, lifecycle transition, import record identity or persistence detail for meter configuration/epochs, public QR tokens, holidays, image review and user-facing inbox state. Resolve these within shared contracts and the one-installation model before implementation. No extra collection or API is implied here. Track implementation in [TASKS.md](TASKS.md) and verify its behaviour through [TESTING.md](TESTING.md).
