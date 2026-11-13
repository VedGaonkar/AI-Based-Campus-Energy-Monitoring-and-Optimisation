# Validation and Acceptance Plan

**Status:** All application checks below are pending. There is no application source, dependency manifest, test runner configuration, build script or application test suite in this repository. The scripts and tests under `.agents/skills/` support reusable design tooling; they do not verify the campus-energy application. No application tests, builds, API smoke checks or hardware tests have been run for this documentation update.

[PLAN.md section 21](PLAN.md#21-acceptance-checks) defines the authoritative acceptance matrix. This file organises its checks for implementation; it does not record passing application results.

## Test approach and prerequisites

Use deterministic meter/timetable fixtures and controllable time for policy tests. Cover calculation and policy logic first, then validate API persistence, worker recovery and selected browser workflows against the actual implementation. The planned tools are the Node test runner or Vitest, Supertest and selected browser checks; no runner has been selected or installed yet.

Use test accounts and a separate test database. Preserve fixture provenance as simulated throughout the pipeline. Device commands default to the simulator, and optional integrations must be independently disableable. Record the actual runtime, dependency/model versions, fixture inputs, commands and results once they exist; do not invent `npm` scripts or a passing test count.

## Energy, imports and recommendations

| Check | Required result |
| --- | --- |
| Cumulative reading increases from 1,200 to 1,206 kWh over one hour | 6 kWh consumed; 6 kW average over the interval |
| Same increase over two hours | 6 kWh consumed; 3 kW average |
| Missing readings or partial day | Retain the aggregate gap interval and coverage; do not invent hourly measurements or complete-day totals |
| Cumulative versus interval inputs | Difference cumulative readings; sum interval energy; reconcile duplicate sources without double counting |
| OCR error, wrong register, bad units/decimal placement or implausible chronology | Review/re-capture or reject according to validation; unaccepted readings cannot create measured charts or false anomalies |
| Meter reset, replacement or rollover | Explicit epoch handling; no negative consumption or comparison across incompatible epochs |
| Duplicate import, source event or repeated commit | No duplicated energy, incident or notification job; preview reports invalid/duplicate rows and timezone assumptions |
| Large apparent jump | Repeat/read review before energy anomaly triage; unusual usage alone is not an automatic rejection |
| Low baseline history | Label an initial-rule baseline or insufficient data; do not invent anomaly confidence |
| Baseline matching | Use compatible intervals/calendar/schedule context, record baseline version and exclude known bad readings |
| Calendar boundaries | Persist UTC; interpret pilot schedules/daily totals in `Asia/Kolkata`, without shifting local-day coverage |
| Building spike without room metering | Candidate contributors remain evidence-limited; no fabricated room kWh, definite cause or arbitrary room cutoff |
| Savings and cost | Disclose tariff, period and rated-load assumptions; distinguish estimates, observed reductions and verified savings |
| Overlapping recommendations or non-positive net benefit | Avoid duplicate benefits; show payback only for positive net benefit |

Verify [CSV contracts and calculations](PLAN.md#6-meter-ingestion-validation-and-calculations), [baseline rules](PLAN.md#7-baseline-and-anomaly-engine) and [savings formulas](PLAN.md#83-savings-and-roi-calculations) against their actual implementations. Monthly utility totals must not be presented as measured hourly spike data, and interval-average kW must not appear as instantaneous demand.

## Occupancy, timing and durable work

With initial pilot defaults, confirm vacancy for 15 minutes before establishing an eligible incident. The first alert is `t = 0` on that incident's clock, HOD/second-responder escalation is `t = 10 minutes`, and final eligibility recheck is `t = 25 minutes` (15 additional minutes). This is about 40 minutes from the last positive occupancy when all later checks continue to pass. These configurable delays are separate from any accelerated demonstration clock.

- An occupied room is protected without a booking. Current bookings and the preparation window protect vacant rooms; tomorrow's unrelated booking does not.
- Fresh credible occupancy at minute 24, a new booking, QR lease or override invalidates the pending minute-25 cutoff. Revalidate after waiting for a command lock and reject stale policy versions/deadlines.
- Camera/sensor failure, staleness, unusable darkness, inadequate coverage or disagreement without a fresh positive signal yields unknown and blocks vacancy-driven cutoff. Test a seated person in the least visible area and separate corridor/room regions.
- Acknowledgement alone does not resolve an incident. After snooze expiry, reevaluate current evidence before progressing. Reopened issues get a new incident episode/timeline.
- Restart the worker before escalation and during leased work. Recover persisted due jobs, reclaim expired leases, cancel obsolete work and avoid blindly replaying commands. Browser closure must not stop escalation.
- Retry failed notification delivery through configured backup routing. Preserve distinctions among attempted, provider-accepted, delivered, read and acknowledged; do not claim exactly-once delivery when the provider cannot ensure it.
- Exercise duplicate events/MQTT delivery, concurrent issue creation and command requests. Require database-enforced deduplication, one active issue per key and explicit idempotent ON/OFF; a duplicate must not reverse state.
- Retained presence retains its original capture time and cannot become fresh occupancy. Reconnection must reject expired switching commands.

See the [persistent scheduler design](PLAN.md#15-persistent-scheduler-incident-states-and-command-handling) and [database consistency requirements](DATABASE.md). TTL cleanup and frontend countdowns must not execute control deadlines.

## QR access and permissions

- Verify login, permitted room, allowed hours, duration, booking conflicts and lockouts on lease creation and extension. Initial defaults are a maximum 120-minute lease and warning 10 minutes before expiry.
- A newly authorised lease/extension cancels old pending cutoff work. Expiry without an occupancy source leaves occupancy unknown and creates staff work under the default physical policy.
- Exercise any explicitly opted-in fixed-duration supply policy independently from vacancy detection, including warning, extension, acceptance and local override. It must retain fault/essential-load interlocks.
- Reject unauthorised direct API mutations, room-scope violations, service-source spoofing and unauthorised Socket.IO subscriptions. A student/general viewer has no default power-control privilege.
- Public QR lookup exposes minimal information and never switches power on GET/page load. Authentication and possession of a static QR URL do not establish physical presence.
- Validate session, origin/CSRF, secret redaction, upload limits and scoped-ingestion protections defined in [SECURITY.md](SECURITY.md).

## Room-master controls and failure handling

| Check | Required result |
| --- | --- |
| Duplicate room-master mapping | Reject multiple masters for a room or one master mapped to independent rooms |
| Room master OFF/ON | All mapped ordinary loads lose/regain supply together; ON does not guarantee individual appliance restart |
| Unapproved master, incompatible load or missing AC stop confirmation | Block the whole cutoff and retain a manual action task |
| Required stop confirmed, then AC restarts/evidence becomes uncertain | Invalidate confirmation; block cutoff until the approved procedure is established again |
| Fault trip, maintenance lock, manual isolation or unknown required interlock | No automatic restoration; only automation-disabled supplies are candidates for eligible restore |
| Missing command feedback | Show command-only/unverified status; transport acknowledgement is not confirmed physical OFF |
| Observation/network/essential supply behind room cutoff | Fail commissioning; these supplies must remain available |
| No Wi-Fi or alternative communication path | Indicate local-only/unavailable behaviour; do not claim central control or notification |
| Optional camera/OCR/SMTP/MQTT/gateway unavailable | Clearly unavailable integration; core imports, analytics, recommendations and in-app workflows still work |

Check exact model capabilities and local override during supervised commissioning, following [PLAN.md section 11](PLAN.md#11-hardware-choices-and-room-master-integration). Physical installation is outside the 24-hour prototype; simulator results cannot substitute for installation approval or physical validation.

## Simulation and end-to-end release checks

Demonstration mode must block real adapters on both server and gateway. Test that fixtures, replayed clips and accelerated time cannot produce physical commands or real staff notifications. Keep `dataMode` on every result/chart and display “Simulation: time accelerated 60×” when applicable.

Before calling the prototype complete, perform and record:

- A frontend production build, API smoke check and walkthrough of each role.
- A phone QR check against a reachable application URL, including warning, extension and denied access.
- One complete incident-to-outcome run with first alert, escalation, simulated action and recorded verification level.
- All eight [planned demonstrations](PLAN.md#22-demonstration-script-and-seeded-scenarios), using 30 days of visibly synthetic meter intervals and a few rooms in one building.
- Actual inference/OCR output from a permitted image/clip when available; otherwise record the unavailable integration and honest fallback. Do not substitute a hardcoded detection as a real model result.
- Responsive and keyboard-accessible actions, readable charts and textual state labels alongside colour.
- A fresh setup using the exact documented start/build/seed/test commands after those commands are implemented.

## Documentation validation

For documentation changes, check Markdown links and section anchors, documented paths and commands against the repository, consistent planned/implemented status, and the final diff for unrelated changes. Preserve [PLAN.md](PLAN.md) as the source of truth. Application execution results remain pending until source code and runnable commands exist.

For the 13 November 2026 synchronisation, all 67 Markdown files were audited. Automated checks passed for 111 local links/anchors across the ten project documents, all 48 application API-table entries and 20 collection names against the plan, UTF-8 decoding, balanced fenced blocks and diff whitespace. An independent review reread the full plan and all nine modified supporting documents. The plan's original SHA-256 is unchanged, and the final change scope contains only those nine existing Markdown files. No application tests or builds were run.
