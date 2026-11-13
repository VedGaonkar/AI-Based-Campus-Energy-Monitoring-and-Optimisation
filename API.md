# API and event contracts

**Status:** specification only. No endpoint is implemented yet. Derived from [PLAN.md](PLAN.md) §6.4, §12.3 and §13, which remain authoritative. Update this file when implemented behaviour differs.

## Conventions

- All application routes are under `/api/v1`.
- Stable string IDs, explicit units, ISO 8601 timestamps.
- Requests are schema-validated (Zod).
- Browser clients authenticate with a server session cookie. Integration services use a separate scoped service credential.
- Role and room scope are checked on the server for every mutation and every Socket.IO subscription.
- "Standard error responses" are required by the plan, but their shape is not yet defined.
- The plan lists endpoints and payload contracts separately. The pairing of each contract with an endpoint below is the natural reading and should be confirmed during implementation.

## Application endpoints

Paths are relative to `/api/v1`.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/login`; `POST /auth/logout`; `GET /auth/me` |
| Installation settings | `GET /settings`; `PATCH /settings` |
| Rooms | `GET /rooms`; `POST /rooms`; `GET /rooms/:id`; `PATCH /rooms/:id`; `GET /rooms/:id/status` |
| Inventory | `GET /devices`; `POST /devices`; `PATCH /devices/:id` |
| Assignments | `GET /rooms/:id/assignments`; `PATCH /rooms/:id/assignments` |
| Timetable | `GET /schedules`; `POST /schedules`; `PATCH /schedules/:id`; `POST /imports/timetable` |
| Utility data | `POST /imports/meter-readings`; `POST /meter-readings`; `GET /meter-readings`; `POST /meter-images` |
| Analytics | `GET /analytics/summary`; `GET /analytics/intervals`; `GET /analytics/anomalies` |
| Incidents | `GET /incidents`; `GET /incidents/:id`; `POST /incidents/:id/acknowledge`; `POST /incidents/:id/snooze`; `POST /incidents/:id/resolve` |
| Recommendations | `GET /recommendations`; `POST /recommendations/:id/accept`; `POST /recommendations/:id/reject`; `POST /recommendations/:id/complete` |
| QR access | `GET /access/:publicToken`; `POST /rooms/:id/access-leases`; `POST /access-leases/:id/extend`; `POST /access-leases/:id/end` |
| Override | `POST /rooms/:id/overrides`; `POST /overrides/:id/end` |
| Integrations | `GET /integrations`; `POST /integrations/:id/test`; `PATCH /integrations/:id` |
| Commands | `POST /rooms/:id/supply-commands`; `GET /commands/:id` |
| Ingestion | `POST /ingest/observations`; `POST /ingest/device-events`; `POST /ingest/meter-readings` |
| Operations | `GET /health`; `GET /ready`; `GET /audit-events` |
| Demo only | `POST /demo/scenarios/:id/start`; `POST /demo/reset` |

Notes:

- `/devices` is the observation and load inventory. It exposes no switching. The only control endpoint is the room-level `POST /rooms/:id/supply-commands`.
- `GET /access/:publicToken` returns minimal room and access-policy information only, never controller credentials or full staff details. It must not switch power on page load.
- Acknowledging an incident does not resolve it.

## Occupancy observation

Sent to `POST /ingest/observations`.

~~~json
{
  "eventId": "unique-source-event-id",
  "sourceId": "CAM-R101",
  "roomId": "room-r101",
  "capturedAt": "2026-11-13T10:30:00+05:30",
  "sourceType": "camera",
  "occupancy": "occupied",
  "detectedPeople": 3,
  "confidence": 0.94,
  "coverageValidated": true,
  "quality": { "usable": true, "reason": null },
  "dataMode": "live",
  "modelVersion": "record-actual-model-version"
}
~~~

- `occupancy` is one of `occupied`, `vacant`, `unknown`.
- The server computes freshness and room state. A client cannot force vacancy by posting a count of zero.
- `detectedPeople` is a model observation, not a headcount. `confidence` is not the probability that the room is empty.

## Meter reading

Sent to `POST /ingest/meter-readings`.

~~~json
{
  "eventId": "meter-main-01-capture-unique-id",
  "meterId": "MAIN-01",
  "capturedAt": "2026-11-13T11:00:00+05:30",
  "kind": "cumulative",
  "register": "import_kwh",
  "value": 1206.0,
  "unit": "kWh",
  "sourceType": "camera_ocr",
  "dataMode": "live",
  "quality": {
    "ocrConfidence": 0.96,
    "registerMatched": true,
    "burstAgreement": true
  }
}
~~~

The backend decides `accepted`, `needs_review` or `rejected`. Incoming confidence does not bypass validation.

## Room supply command

Sent to `POST /rooms/:id/supply-commands`.

~~~json
{
  "requestId": "unique-command-id",
  "roomId": "room-r101",
  "roomBreakerId": "BRK-R101",
  "action": "off",
  "reason": "vacancy_escalation",
  "incidentId": "incident-id",
  "policyVersion": 4,
  "expiresAt": "2026-11-13T11:00:30+05:30"
}
~~~

The backend or gateway adds `issuedAt` and the authorised actor, then persists the command before transport. `action` is an explicit `on` or `off`; there is no toggle.

Normalised result, from `GET /commands/:id`:

~~~json
{
  "requestId": "unique-command-id",
  "transportStatus": "acknowledged",
  "reportedOutput": "off",
  "verification": "controller_reported",
  "verifiedAt": "2026-11-13T11:00:02+05:30",
  "dataMode": "simulated"
}
~~~

`verification` is one of `simulated`, `command_only`, `controller_reported`, `independently_metered`, `manually_confirmed`, `unknown`. A simulated result stays simulated even when `reportedOutput` is `off`.

## CSV import formats

Cumulative meter readings (`POST /imports/meter-readings`):

~~~csv
meterId,capturedAt,readingKwh,register,source
MAIN-01,2026-11-13T10:00:00+05:30,1200.0,import_kwh,manual
MAIN-01,2026-11-13T11:00:00+05:30,1206.0,import_kwh,manual
~~~

Interval energy:

~~~csv
meterId,intervalStart,intervalEnd,energyKwh
MAIN-01,2026-11-13T10:00:00+05:30,2026-11-13T11:00:00+05:30,6.0
~~~

Timetable (`POST /imports/timetable`):

~~~csv
roomCode,startAt,endAt,title,status
R101,2026-11-13T10:00:00+05:30,2026-11-13T11:00:00+05:30,BCA lecture,confirmed
~~~

The import preview reports invalid rows, duplicate rows, timezone assumptions, meter epoch, format type and intended data source. Re-imports are idempotent. A CSV label does not make data trusted: simulated fixtures remain simulated.

## Vision and OCR service (internal)

A separate Python service, not under `/api/v1`, reached only by the backend or gateway.

| Method and endpoint | Purpose |
| --- | --- |
| `GET /health` | Service and model availability |
| `POST /v1/observe-frame` | Analyse a supplied bounded frame and region configuration |
| `POST /v1/ocr-meter` | Analyse a supplied bounded meter image |
| `POST /v1/sources/:id/start` | Start an administrator-configured source |
| `POST /v1/sources/:id/stop` | Stop the source |

Source addresses are configured by an administrator; arbitrary camera URLs are not accepted. Every result includes `sourceId`, `capturedAt`, `processedAt`, `modelVersion`, `dataMode` and quality information. If the model is unavailable the service reports it; it never substitutes a hardcoded detection.

## MQTT topics (optional)

Application-defined topics on a private broker. Adapters translate real device protocols; these are not manufacturer topic names.

| Topic | Purpose | Retained? |
| --- | --- | --- |
| `energy/rooms/R101/presence` | Timestamped presence state | May retain; freshness is mandatory |
| `energy/devices/BRK-R101/availability` | Online or offline | Yes |
| `energy/devices/BRK-R101/command` | Explicit action, ID and expiry | No |
| `energy/devices/BRK-R101/result` | Command outcome | No |
| `energy/meters/MAIN-01/reading` | Reading observation | No, or deduplicated state with original capture time |

Use authenticated per-device access control. QoS 1 can deliver duplicates, so events and commands are deduplicated. Retained presence is never treated as fresh occupancy, and ON/OFF commands are never retained.

## Live updates

Socket.IO carries incident, room-state and command updates. Event names and payloads are not yet defined.

Related documents: [DATABASE.md](DATABASE.md), [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md).
