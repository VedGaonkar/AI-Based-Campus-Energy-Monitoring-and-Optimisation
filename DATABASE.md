# Database

**Status:** design only. No schemas, indexes or seed data exist yet. Derived from [PLAN.md](PLAN.md) §14 and §15, which remain authoritative.

MongoDB with Mongoose. One installation configuration for one building; there is no multi-building or tenant hierarchy.

## Collections

| Collection | Essential fields |
| --- | --- |
| `settings` | Installation name, timezone, tariff configuration, default policies, data mode |
| `users` | Name, email, password hash, role, department label, permitted room IDs, active flag |
| `rooms` | Code, name, `roomBreakerId`, capacity if known, zone type, assignments, occupancy policy, shared-cutoff policy, `policyVersion` |
| `roomBreakers` | Unique room ID, adapter, native device ID, feeder coverage, verified ratings, interlocks, supply state |
| `devices` | Room, category, `ratedWatts`, `controlledByRoomBreakerId`, essential or standby flag, interruption approval, required stop and restart rules |
| `integrations` | Source or adapter type, allowed endpoint, credential reference, capabilities, `lastSeenAt`, health |
| `schedules` | Room, start and end, title, status, origin or import ID, timezone, cancellation details |
| `observations` | Event and source IDs, room, capture and receipt times, occupancy or equipment observation, quality, data mode |
| `meterReadings` | Meter, epoch, kind and register, value and unit, time range, provenance, validation state |
| `energyIntervals` | Start and end, kWh, average kW, coverage, source-reading IDs, calculation version |
| `baselines` | Matching rule, expected range, sample count, training window, version |
| `incidents` | Type, room/device or building-meter scope, active flag, evidence, state, responder assignments, timestamps |
| `jobs` | Incident and action, `dueAt`, `policyVersion`, status, lease owner and expiry, attempt count |
| `notificationOutbox` | Incident, stage and recipient, channel, idempotency key, delivery state, provider response |
| `accessLeases` | Room, requester, approved duration, start and expiry, warning and extension state, policy acceptance |
| `overrides` | Room/circuit, creator, scope, reason, start and end, cancellation |
| `commands` | Request ID, target room breaker, action, reason, issue and expiry time, transport result, verification |
| `recommendations` | Pattern, evidence, action, owner, estimate, status, outcome |
| `auditEvents` | Actor or service, action, target, timestamp, redacted before and after |
| `sessions` | Application session store (connect-mongo) |

## Room master modelling

- A controlled room references exactly one `roomBreakers` document. A second master for the same room is rejected, and one master cannot map to two rooms.
- `devices` is a load and observation inventory. A device has no switching endpoint; it records which room breaker supplies it and whether it may be interrupted.
- For ACs and other sensitive loads, record `supplyInterruptionApproved`, `requiresNormalStopBeforeCutoff`, `stopProcedureConfirmedAt`, `restartDelaySeconds`, `restartBehaviourKnown`, `essentialStandbyRequirement` and `approvalNotes` (PLAN.md §11.3).
- The breaker's supply state must distinguish a supply the application opened from a fault trip, a maintenance lock or manual isolation, because only the first may be restored automatically.

## Indexes and idempotency

- Unique event ID per integration or source.
- Unique room code.
- Unique room ID in `roomBreakers`.
- Unique command request ID.
- Unique import identity for each source record.
- Unique notification key over stage, incident, recipient and channel.
- Partial unique index allowing one active incident per issue key.
- `jobs` indexed by status and `dueAt`.
- `schedules` indexed by room and start and end.
- `observations` indexed by room or source and `capturedAt`.
- `meterReadings` indexed by meter, epoch, register and time.

Duplicates are prevented by database indexes, not by frontend checks. Re-importing the same file or receiving the same event twice must not double consumption, incidents or notification jobs.

## Consistency rules

- **Occupancy facts stay separate.** Store observed occupancy, authorised-use protection, controller-reported supply state and appliance-state evidence as distinct fields. An expired lease or a cancelled class is not an occupancy observation.
- **Meter epochs.** Cumulative readings are only differenced within one epoch. A meter replacement, reset or rollover starts a new epoch, so consumption is never negative.
- **Missing stays missing.** Do not copy an old reading forward under a new timestamp. A gap is stored as one aggregate interval with its coverage.
- **Provenance is permanent.** Source label and `dataMode` are stored on every reading, observation and command and are never upgraded; simulated data stays simulated.
- **Incident episodes.** Reopening an issue creates a new episode with a new timeline.
- **Jobs.** A job is claimed with a conditional update that sets a lease. Timing comes from `dueAt`. Expired leases are recovered on restart and the job is re-evaluated against current state.
- **Transactions.** Multi-document transactions require a MongoDB deployment that supports them. Without one, do not claim atomicity across collections; rely on idempotent operations.
- **TTL.** TTL indexes may clean old sessions and observations under the retention policy. TTL cleanup is not a precise timer and must never drive a power-control deadline.
- **Time.** Persist timestamps in UTC. Use Asia/Kolkata for display and calendar interpretation, and compute daily totals on local-day boundaries.

## Seed and demo data

Planned: test accounts for each role, a few rooms in one building, and 30 days of synthetic meter intervals labelled as simulated and kept visibly separate from any real readings. No seed script exists yet. Do not seed real staff email addresses.

Related documents: [API.md](API.md), [ARCHITECTURE.md](ARCHITECTURE.md).
