# Validation and Acceptance Plan

**Status:** Application unit/API/database checks and a frontend build now exist. Executed results are recorded separately from the wider pending PLAN acceptance matrix. Tool tests under `.agents/skills/` remain unrelated. No physical hardware tests have been run.

[PLAN.md section 21](PLAN.md#21-acceptance-checks) defines the authoritative acceptance matrix. This file separates executed application checks from broader pending acceptance work.

## Available commands and recorded checks

Run from the repository root after `npm ci` and `npm run setup`. npm scripts use the workspace-local Node 26.13.1. Tests launch isolated real MongoDB 8.2.6 with a cached/downloaded binary; no running application or external database is needed for `npm test`.

| Command | Purpose | Recorded result |
| --- | --- | --- |
| `npm run test:unit` | Calculations, calendar, occupancy/protection and control interlocks | Initial 13 passed; the added historical-baseline case is included in the 31-check full run |
| `npm test` | Unit plus Supertest/API/MongoDB/session/worker/config recovery | 31 passed, zero failures, after seed/PATCH/normal-stop regression fixes |
| `npm run check` | Server/shared/script/test JavaScript syntax | Passed for 25 files at final implementation checkpoint |
| `npm run build` | Vite production build and JSX compilation | Final copy-cleanup build passed; main/chart lazy split, no large-chunk warning |
| `npm run dev` | Local MongoDB, API, worker and Vite | Started; frontend HTTP 200 and API health with physicalControl=false verified |
| `npm run test:browser` | Installed headless Chromium: real login/pages/escalation/QR/narrow viewport | 13 passed; zero browser runtime errors; desktop and loaded 390px screenshots inspected |
| `npm run stop` | Stop only the recorded owned dev services | Passed; reused MongoDB preserved |
| `npm ci --dry-run --ignore-scripts --offline` | Check lockfile/install-plan consistency without reinstalling | Passed; not a clean-environment install test |
| `npm start` plus built-app HTTP smoke | Built index/deep links/assets, health/readiness, protected API | Frontend/asset/readiness HTTP 200, rooms JSON 401; physicalControl=false; owned server stopped afterward |

Browser smoke requires the running dev stack, demo configuration, generated local credentials and installed Chrome/Edge (or `BROWSER_EXECUTABLE`). It uses an isolated ignored profile and Node's built-in WebSocket/Chrome DevTools Protocol, downloads no browser, and writes screenshots/report under `.local/`. Browser-package tarball downloads failed, so no additional browser-test package is required. A successful smoke run changes only synthetic demonstration state and stops replay afterward.

Covered API cases: login/session/hash redaction; CSRF/origin/viewer/room denial; all three CSV formats and repeat-safe commit; seed rows/intervals/anomaly actually persisted; invalid rows/reading conflicts; audited manual review/epoch boundaries; duplicate master mapping; booking cancellation and PATCH preservation; QR GET safety/extension/unknown expiry; escalation through a new Mongo connection; command idempotency; occupancy cancellation; faulted restoration; source-scoped deduplication/conflicts; normal-stop audit/restart invalidation; acknowledgement versus resolution and recommendation outcome uncertainty. Startup rejects physical enablement and accelerated non-demo clocks. Wider scenarios below are not all verified yet.

Known failed checks and fixes: initial browser found an empty chart because bulk-upsert UUID defaults dropped seed rows silently; wrapped defaults and explicit validation errors plus stored-row tests fixed it. An expanded stop/restart test exposed Zod defaulted omitted PATCH fields; explicit-key parsing and policy/cancelled-booking regression checks fixed it. Final 31-check suite and 13-check browser run passed after those fixes. Chrome requires outside-sandbox execution in this environment; default-sandbox Page.enable timed out. No real phone, installed electrical hardware, live inference/OCR, external notification or production HTTPS/retention/security certification was tested.

## Test approach and prerequisites

Use deterministic meter/timetable fixtures and controllable time. The implementation uses the Node test runner, Supertest, real MongoDB and selected browser smoke checks; it does not use Vitest. Broaden checks when changes or unresolved concerns justify them.

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

At the earlier documentation-only checkpoint on 13 November 2026, 67 Markdown files, 111 project links, 48 plan route entries and 20 planned collections were checked. That historical count predates implementation, continuity files and additional workflow routes; it is not the current application validation result. PLAN.md remains unchanged. Consult PROGRESS.md/HANDOFF.md and the table above for current checks.

Final implementation documentation check: twelve root Markdown files, 113 local links/anchors and 30 actual implementation paths passed, along with exact dependency pins, ignored artifact boundaries and Git whitespace. PLAN's initial SHA-256 and reusable skill files are unchanged. Broader field/production acceptance remains explicitly pending.
