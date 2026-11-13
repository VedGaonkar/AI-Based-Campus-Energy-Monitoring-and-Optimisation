# API and integration contracts

**Status:** Planned contracts, not an implemented API. The repository has no application server, route handlers, shared schemas or OpenAPI document. No endpoint or integration below has been exercised. [PLAN.md](PLAN.md) is authoritative; this file organises its contracts for implementation.

## Application boundary

All application routes use the `/api/v1` prefix. The paths in the table below are relative to that prefix. Use stable string IDs, explicit units, ISO 8601 timestamps, schema validation and standard error responses. Persist timestamps in UTC; interpret the pilot's calendar/display in `Asia/Kolkata`.

The Node backend owns authentication, room scope, policy decisions, ingestion acceptance, jobs and commands. The browser submits requests to it. Python inference and hardware adapters supply evidence or results; neither owns switching policy.

Apply server-side role and room checks to mutations and Socket.IO subscriptions. Use scoped service credentials for ingestion. A public QR lookup exposes only minimal room/access-policy information. Creating, extending or ending a lease requires authenticated authorisation; GET/page load must not switch power. See [SECURITY.md](SECURITY.md).

## Planned application routes

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

The exact CSV examples live in [PLAN.md §6.4](PLAN.md#64-import-contracts). Preserve these headers:

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

These functions are application contracts, not universal manufacturer endpoints. Exact hardware model, firmware, protocol, feedback capabilities and connection tests remain to be selected and implemented.

Optional private MQTT topics follow [PLAN.md §13.5](PLAN.md#135-application-mqtt-topics). Commands and results are not retained. Retained presence keeps its original timestamp and must pass freshness checks. Deduplicate QoS 1 deliveries using stable event/request IDs, enforce per-device access and reject expired commands after reconnection. Socket.IO is for authorised application updates; event names and payload schemas remain to be defined.

## Contract work still required

The plan defines route names and selected event examples, rather than a complete HTTP specification. Request/response schemas, error envelopes/status mappings, pagination, Socket.IO contracts and remaining enum values must be agreed and tested during implementation.

The required workflows include import preview/commit and OCR correction, incident inspection/reassignment, recommendation scheduling/verification, staff administration and the persisted in-app inbox. The route table does not specify dedicated operations for all of them. Resolve that mapping in shared contracts before wiring the UI; this document does not invent endpoints or imply those workflows already exist. Track the work in [TASKS.md](TASKS.md), with acceptance evidence in [TESTING.md](TESTING.md).
