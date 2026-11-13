# Tasks

Work breakdown and progress for the 24-hour build. Derived from [PLAN.md](PLAN.md) §19.2, §20 and §26, which remain authoritative.

**Progress:** planning and documentation are done. Implementation has not started; no application code exists.

Tick an item only when it is implemented and checked. Acceptance scenarios are tracked in [TESTING.md](TESTING.md).

## Done

- [x] Implementation plan written ([PLAN.md](PLAN.md)).
- [x] Control architecture decided: one Wi-Fi smart master breaker per controlled room.
- [x] Supporting documentation aligned with the plan.

## Decisions needed before or during the build

- [ ] Choose the person-detection model and record its licence.
- [ ] Decide how demo time acceleration works with `dueAt`-driven jobs.
- [ ] Decide how the session is shared with the Socket.IO handshake.
- [ ] Define the standard error response shape.
- [ ] Commit the problem statement (ps_final.pdf) or replace its private link in PLAN.md §27.
- [ ] Split the phases below across team members; the plan gives a single serial timeline.

## Phase 1 — Foundation (hours 0–2)

Exit condition: login works and one room is available through the API.

- [ ] Confirm an Active LTS Node.js version and a Python environment.
- [ ] Scaffold `frontend/` with the Vite React JavaScript template and the current Tailwind Vite integration.
- [ ] Scaffold `backend/` with Express, the session store and Zod validation.
- [ ] Connect MongoDB and create the required indexes.
- [ ] Define shared contracts and enums in `shared/`.
- [ ] Implement login, logout, current user and role checks.
- [ ] Seed test accounts and rooms.

## Phase 2 — Ingestion (hours 2–5)

Exit condition: uploaded data produces correct consumption.

- [ ] Meter CSV import with preview, validation and idempotent commit.
- [ ] Manual meter reading form with provenance.
- [ ] Timetable CSV import and editing, including cancellations and holidays.
- [ ] Interval calculation with meter epochs, gaps and coverage.

## Phase 3 — Analytics (hours 5–8)

Exit condition: an explainable anomaly and an actionable recommendation card are visible.

- [ ] Overview dashboard with the actual versus expected chart and source labels.
- [ ] Baseline engine with initial-rule and insufficient-data fallbacks.
- [ ] Anomaly detection and anomaly incidents.
- [ ] Recommendation rules with non-overlapping kWh and rupee estimates.

## Phase 4 — Incidents and escalation (hours 8–11)

Exit condition: restart-safe first, second and final stages.

- [ ] Observation ingestion and room occupancy aggregation.
- [ ] Incident lifecycle and timeline.
- [ ] MongoDB-backed job worker with leases and recovery.
- [ ] In-app notifications with a persisted outbox and live updates.

## Phase 5 — Access and simulated control (hours 11–14)

Exit condition: access, extension and cancellation work with simulated control.

- [ ] QR access leases with role checks, expiry warning and extension.
- [ ] Staff overrides.
- [ ] Simulated room-master adapter implementing the adapter contract.
- [ ] Room-level supply commands with final eligibility checks and verification levels.

## Phase 6 — Vision and OCR (hours 14–17)

Exit condition: at least one genuine integration exercised, or honestly shown as unavailable.

- [ ] FastAPI service with health reporting.
- [ ] Person detection on an approved clip, in replay mode.
- [ ] Meter-image OCR with review and correction.

## Phase 7 — Admin and outcomes (hours 17–20)

Exit condition: the end-to-end workflow is usable by each role.

- [ ] Admin screens: rooms, inventory, room-to-master mapping, assignments, tariffs, thresholds.
- [ ] Integration list with connection tests and health.
- [ ] Recommendation accept, reject, complete and outcome tracking.
- [ ] Budget estimator and audit history.

## Phase 8 — Verification (hours 20–22)

Exit condition: core acceptance scenarios pass.

- [ ] Automated tests for calculations, policies, permissions and timers.
- [ ] Failure cases: offline camera, bad OCR, stale evidence, worker restart.

## Phase 9 — Demo and documentation (hours 22–24)

Exit condition: a reproducible demo with clear evidence labels.

- [ ] Deterministic demo fixtures and scenario start and reset.
- [ ] README updated with the real start, build, seed and test commands.
- [ ] Record implemented integrations, dependency versions, model licences and remaining limitations.

## Optional integrations

Disabled by default, behind connection tests. Build only after the core works.

- [ ] SMTP email notifications.
- [ ] MQTT ingestion for presence nodes.
- [ ] ESPHome template for an LD2410 presence node.
- [ ] Physical room-master adapter for a selected, documented breaker model.
- [ ] Home Assistant gateway route.

## If time is short

Keep, in this order: real CSV and manual ingestion, analytics, recommendations and action tracking. Then fall back:

1. In-app notifications instead of SMS, WhatsApp or SMTP.
2. Simulator instead of mains hardware.
3. An approved prerecorded clip instead of a live camera.
4. Manual meter import instead of OCR.
5. Optional integrations shown as disconnected with a connection guide, never faked.

Do not add multi-building features, and do not drop recommendations to work on appliance detection.

## Out of scope

Multi-building management, facial recognition or attendance, per-appliance switching, AC IR blasters, smart plugs, per-button modules, payment checkout, and any required LLM API. Full list in PLAN.md §1.2.

## Final completion checklist

The release gate is the checklist in PLAN.md §26. Do not duplicate it here; tick it there when the build is complete.
