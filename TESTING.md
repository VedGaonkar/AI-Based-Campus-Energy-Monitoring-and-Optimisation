# Testing

**Status:** no tests exist and none have been run, because no application code exists yet. This file defines what must be verified. Derived from [PLAN.md](PLAN.md) §21 and §22, which remain authoritative.

## Approach

Tests target calculations and actions that could mislead users or cause an incorrect command. They are not cosmetic checks.

| Planned tool | Use |
| --- | --- |
| Node test runner or Vitest | Policy, calculation and import unit tests |
| Supertest | API and permission tests |
| Selected browser checks | End-to-end flows |

The runner has not been chosen and there is no test command yet. Record the real command in [README.md](README.md) once it exists. Never report a test as passing unless it was run.

## Acceptance scenarios

Tick a scenario only when an automated test or a recorded manual check covers it.

### Energy calculations and ingestion

- [ ] Cumulative reading 1,200 to 1,206 over one hour gives 6 kWh and 6 kW average.
- [ ] The same increase over two hours gives 6 kWh and 3 kW average.
- [ ] A meter gap shows one aggregate interval; no invented hourly points.
- [ ] A bad OCR digit or wrong register goes to review or re-capture; no false anomaly.
- [ ] A meter reset or replacement starts a new epoch; no negative consumption.
- [ ] A duplicate import or event does not double consumption, incidents or notification jobs.
- [ ] Low baseline history shows the initial-rule or insufficient-data label.
- [ ] A building spike without local metering produces no fabricated room kWh or definite cause.
- [ ] Overlapping saving recommendations are not counted twice.

### Occupancy and schedule protection

- [ ] An occupied room with no booking is not shut down.
- [ ] A vacant room with an active or preparation-window booking is protected.
- [ ] A booking tomorrow does not protect today's idle period.
- [ ] A person entering at minute 24 cancels the pending minute-25 cutoff.
- [ ] A camera or sensor disconnect yields unknown occupancy and blocks automatic cutoff.
- [ ] A blind spot that hides a seated person fails coverage validation; vacancy is not claimed.
- [ ] Stale retained presence does not become fresh evidence.

### Incidents, escalation and jobs

- [ ] An acknowledgement alone leaves the incident unresolved.
- [ ] An expired snooze re-evaluates current evidence before further action.
- [ ] A worker restart before escalation recovers persisted work without repeating old commands.
- [ ] A new booking or override arriving during a queued action invalidates the stale work.
- [ ] Duplicate MQTT delivery is idempotent; no toggle reversal.

### QR access and permissions

- [ ] A QR lease starting during a pending cutoff invalidates the cutoff.
- [ ] A QR lease expiring with no occupancy source leaves occupancy unknown and applies the configured expiry policy.
- [ ] A QR extension that conflicts with a booking is rejected or requires approval.
- [ ] An unauthorised QR or control request is denied on the server.

### Room master control

- [ ] A room master command without feedback is recorded as command-only or unverified, not confirmed OFF.
- [ ] An AC that requires a normal stop blocks the whole room cutoff until the stop is confirmed.
- [ ] Room master OFF removes supply from all mapped ordinary loads together.
- [ ] Room master ON makes supply available; individual switches and restart rules still apply.
- [ ] Mapping more than one master to a room is rejected.
- [ ] An incompatible load or unapproved room master blocks shared cutoff and creates a manual task.
- [ ] A fault-tripped or maintenance-locked breaker is not restored automatically.
- [ ] With no Wi-Fi and no network route, local-only mode is shown and central notifications are not claimed.

### Simulation isolation

- [ ] With the demo clock accelerated, only simulated actions and test notifications occur.

## Manual checks before a demonstration

- [ ] Frontend production build completes.
- [ ] API smoke check passes.
- [ ] Walkthrough as each role.
- [ ] QR page opened from a phone on a reachable URL.
- [ ] One full run from incident to recorded outcome.

## Demonstration scenarios

Seeded with a deterministic dataset: 30 days of synthetic, labelled meter intervals and a few rooms in one building.

| Demo | What it shows |
| --- | --- |
| 1. Normal class | Presence or an active booking; no unnecessary warning |
| 2. Forgotten lights | Vacant room, no booking; first alert, HOD escalation, simulated OFF |
| 3. Person returns | Occupancy cancels the pending shutdown and restores an automation-disabled supply where eligible |
| 4. QR access | Authorised request enables simulated supply; warning and extension |
| 5. Building anomaly | Actual versus expected chart and a suspected contributor with evidence limits |
| 6. Unknown cause | Manual inspection requested, including unmonitored areas; no false attribution |
| 7. Optimisation card | Recommendation, estimated benefit, owner and completion outcome |
| 8. Failure handling | Camera offline or bad meter image gives unknown or review, not blind switching |

Time acceleration runs only in isolated simulation mode and displays "Simulation: time accelerated 60×". Show model or OCR output only when it was really produced from the selected image or clip; otherwise show the fallback honestly.

## Fixtures

Planned under `fixtures/`: synthetic readings, schedules and observations, plus permitted sample media. All fixtures are labelled simulated and stay simulated through the pipeline. None exist yet.

Related documents: [TASKS.md](TASKS.md), [SECURITY.md](SECURITY.md).
