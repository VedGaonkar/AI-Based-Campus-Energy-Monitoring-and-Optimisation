# Validation and Acceptance Plan

## Optional sustainability reporting (CE-020)

`node --test --test-concurrency=1 tests/sustainability.test.js` covers kWh/kg CO2 conversion, applicable factor history/boundary ambiguity, missing/zero/unequal baselines, increases, long aggregates/partial/future periods, timetable/occupancy/simulation recognition gates, social numerator/denominator and approval, governance rubric/missing evidence, module opt-in, strict server validation, Admin/Viewer permissions, immutable exported snapshots/checksum/source readings, source acceptance/units and cross-building isolation. Uses only isolated temporary MongoDB/accounts.

After `npm run build`, `npm run test:sustainability-browser` runs the real production bundle in isolated headless Chrome and a temporary institution. It exercises Administrator enablement, labelled filter/calculation consistency, assumption/provenance/palette, keyboard help, actual save/JSON download, activity form/pending evidence and approved score update, offline/correction/reconnect with historical export stability,390px layout,no-data state and Viewer restrictions. Evidence is written under ignored `.local/sustainability-browser.json`, logs and screenshots. Final execution results are recorded in HANDOFF.md/PROGRESS.md; no real-meter calibration, touchscreen, screen-reader, institutional evidence authenticity or formal sustainability accounting certification is implied.

## Meter-camera acceptance (CE-016)

Run node --test tests/meter-camera.test.js after npm run setup:ocr. Pure/parser and source/scheduler checks remain separate from optional real OCR tests; missing engine skips are explicit and never count as recognition. Executed tests cover point/comma/implied decimals,Wh conversion,wrong registers,duplicates,real synthetic image/orientation,review/correction without lost evidence,automatic permission reset,paired scheduled capture,hourly calculations/CSV overlap,non-monotonic/future/stale data,gap aggregates,loss/expiry,no occupancy effects,reset isolation and retention.

After build, npm run test:meter-browser uses isolated Chrome profiles and a synthetic canvas video substituted for getUserMedia. JPEG capture,capability transport,Tesseract,review and image preview are real; the meter and video source are synthetic. No actual phone/physical meter accuracy claim is made. The test checks administrator registration/60min default,real OCR review/acceptance,paired source isolation and stopped-camera health. Existing occupancy/demo and energy regressions must also pass. Physical positioning/lighting/cycling-register/hour-long rehearsals remain in METER_CAMERA.md.


## Live synchronisation verification (CE-014)

node --test tests/live-sync.test.js uses isolated MongoDB and independent admin/viewer/foreign sockets. It verifies persisted mutations, denied writes/no events, every required resource, requested vs failed vs simulator ACK, event uniqueness, another database connection's background/provider writes, reconnect checkpoint/current data, room permission removal, membership revocation, ordering/coalescing, foreground recovery, aborted/old responses and listener cleanup.

After npm run build, node scripts/realtime-browser.mjs uses three independent installed-Chromium profiles and two real tabs in one profile. The isolated simulator workflow checks authorised supply OFF propagation, rename propagation/isolation, native OFF request/transport failure, stale disconnect banner and missed-update recovery, single inbox notification and stable connection count across navigation. Network emulation blocks reconnect HTTP; the harness also closes the established viewer transport because some Chromium versions retain existing WebSockets during offline emulation. All data/credentials are temporary. This is no physical-device/real-phone/production-network verification. Run the existing regressions and npm run check:client-secrets as well.


## Building authentication verification (CE-018)

`npm test` includes tests/building-auth.test.js, institutions.test.js and auth-environment.test.js alongside all existing policy/integration suites. Coverage includes empty admin signup with the correct server registration key and rejection of wrong/missing keys, correct/invalid/disabled Viewer code, strong validation/password confirmation, hash/member preservation, unique code races, rotation serialization, rename, role/ID injection, caught failure rollback, secret-free APIs/audit and registration throttling. Cross-building API/job/socket/source/migration/demo checks remain. Retired-flow assertions now test rejection instead of obsolete grants.

Build, then `npm run test:auth-browser`: isolated temporary MongoDB/Chrome checks exact login fields, both forms, confirmation, empty building, write-only rotation, old-code failure without account, Viewer building/role, password-only logins, authorised multi-membership choice, pending access denial and 390px layout. Configured user data is never used. Current executed counts are recorded in HANDOFF.md.

## Retired authentication verification

Earlier key-based sign-in, promotion and invitation behavior is retired. The creation-only Administrator key requirement is covered by the current tests. Historical execution records remain in HANDOFF.md/PROGRESS.md; current checks cover password-only memberships and Building Join Codes.

## CE-011 - two-phone software demonstration (13-14 November 2026)

- Final `npm test`: **86 passed, 0 failed**, including all prior 70 application/HA checks and 16 new phone-demo tests. Actual QR pixels, foreign-session/role/command isolation, one-use expiry/revocation/re-pair generations, configured-origin CORS, MIME/size/timestamp/sequence/processing bounds, HOG unknown/injection separation, room-lock contention, persistent stages and API/database-client restart, booking/QR/override/occupancy cancellation, missing ACK/expiry/reconnect, all-load effective OFF and original load/restoration/live gates were exercised in isolated MongoDB.
- `npm run test:phone-browser`: **10 passed, zero runtime errors**, repeated against the final preview/pairing/CORS behavior. Three isolated Chrome instances used generated credentials and temporary data: dashboard creates/pairs, both phone apps render seven scenes/lock, synthetic video-only canvas stream uploads actual rendered classroom pixels, Python decodes them, the persistent worker completes first/+10s/+15s stages, Phone B applies every effective load OFF and ACKs, a later independent pixel frame reports the OFF marker, camera stop produces unknown, occupied pixels cancel another incident, 390px layouts fit and ending revokes access.
- `npm run test:admin-browser`: **14 passed, zero runtime errors** against current navigation/API changes. Prior browser counts are historical; only these newly executed 24 checks are this milestone's browser evidence.
- `npm run check`: **55 JavaScript files passed**; `npm run build`: dashboard build and both independent buildless phone entry/assets checks passed. Python code was executed through real pixel tests, not treated as a stub. Latest main bundle approximately 459KB and lazy chart 381KB; no large-chunk warning.
- Evidence: `.local/phone-final-tests.log`, `phone-demo-browser-verification.json`, `phone-admin-browser.log`, `phone-check.log`, `phone-build.log`, and `screenshots/phone-*.png` (ignored). Desktop/mobile images inspected. Reports contain no real credentials or physical switching claims.
- Managed API/worker/frontend restart passed, preserving external MongoDB. Both independent phone startup commands and **13 public runtime/readiness checks passed**, including assets/proxies, health/DB, disabled live gates and unauthenticated/unpaired rejection. Evidence `.local/phone-runtime-verification.json`. Standalone previews stopped; main app left running. Actual live seeded-admin login returned 401 because that existing account is inactive/HOD; no account was changed. Live authenticated smoke was skipped; 14 isolated admin browser checks passed separately. Use an existing active administrator.

Earlier failures were repaired and are not counted as passes: cold OpenCV process made a first frame stale (warm at session creation); premature runner navigation/module clicks; overbroad vacancy cancellation of manual ON; transient policy locks classified as camera failure; QR downsampling/partial synthetic-canvas updates (larger compact signed markers, bounded multi-scale decoder, atomic feed drawing). A final older QR extension test crossed midnight: it correctly received 409 for a cross-day lease. Its clock is now fixed using Node's documented Date mocking; production policy was not weakened. Source timestamps/failure still produce unknown and no blind cutoff.

**Physical limits:** the browser input was an explicitly synthetic canvas MediaStream of rendered screenshots. No actual two-phone camera/display, trusted LAN HTTPS certificate/firewall, consenting teammate HOG positive, physical breaker or live HA device was tested. No measured room kWh/savings were inferred. Follow [DEMO_SETUP.md](DEMO_SETUP.md) for the supervised field checklist and exact startup commands; live controls remain disabled.

## CE-010 — Home Assistant / existing native OFF equipment

Verified 13 November 2026 against the current working tree:

- `npm test`: **70 passed, 0 failed** using isolated MongoDB and protocol-faithful local HA HTTP/WebSocket mocks. Includes token rejection/redaction, role/room scope, encrypted credentials, destination/DNS/redirect/timeout/size protections, exact OFF actions, unsupported/group/master exclusions, duplicate/renamed bindings, timestamp ordering/reconnect, all live gates, zero gateway traffic in simulation, durable restart/expiry, booking/QR/override/occupancy protection, required native shutdown prerequisites and failure without breaker fallback.
- `npm run check`: **40** server/shared/script/test JavaScript files passed. Frontend JSX verified by production build.
- `npm run build`: passed; main JavaScript approximately 447 KB, lazy chart approximately 381 KB, no large-chunk warning.
- `npm run test:devices-browser`: **9** isolated Chrome checks passed, zero runtime errors. Creates a simulator, discovers/maps/reviews a target, performs explicit OFF, enables automation, exercises first/HOD/final escalation and reported-state confirmation, cancels on occupancy, retains unverified/unavailable results without breaker fallback, checks 390px layout and disconnect cleanup.
- `npm run test:admin-browser`: **14** isolated Chrome checks passed, zero runtime errors, after the connected-device/navigation/socket changes. Uses temporary data and generated credentials.
- `git diff --check`: passed (Git's LF/CRLF notices are line-ending information).
- Managed local restart and **7 runtime checks** passed: existing seeded admin password/key login, authenticated connection/device/building routes, frontend deep link, both live-control gates disabled and logout. External MongoDB preserved; no demonstration fixtures were added to the user's database. App left running at localhost:5173; evidence `.local/native-runtime-verification.json`.

The first final full suite passed 69/70 because the new socket-only regression closed MongoDB before asynchronous session-store initialisation completed. Setup now exercises a persisted CSRF/session request; the complete repeat passed 70/70. Earlier browser failures and fixes are recorded in PROGRESS.md rather than counted as successes.

Evidence is ignored under `.local/`: `native-final-tests.log`, `native-final-check.log`, `native-final-build.log`, `connected-devices-browser-verification.json`, `admin-browser-verification.json` and `screenshots/connected-device*.png`. Desktop and mobile screenshots inspected. No user database fixtures or real gateway credentials were used by these isolated tests.

These checks establish software/protocol behaviour only. Mock provider-reported OFF and simulated OFF are not physical verification, measured zero power or measured savings. No HA host, authorised token, exact model/firmware/entity or genuine field occupancy source was supplied. Follow [HOME_ASSISTANT.md](HOME_ASSISTANT.md) for live prerequisites and supervised acceptance; live automation remains disabled by default. Other vendor/assistant adapters remain deferred.

## Current role checks

Code-based Viewer promotion has been removed. Existing role/hash/member preservation, profile/login forgery rejection and existing-session privilege checks remain in the current suites.

## CE-009 administrator architecture verification

- `npm test`: 45 passed, zero failures in isolated MongoDB databases. Added coverage rejects invalid/missing/disabled admin keys without viewer fallback, verifies admin registration and login, audits password/key-based viewer activation, rotates sessions, prevents role/profile forgery and self-lockout, and rejects admin access from an unverified session after a role change.
- Management cases verify persistent building details, immutable floor/space identity, duplicate codes, invalid floor mappings, room/master independence, bulk floor/space generation, camera/no-camera mapping, scoped one-time gateway tokens, simulator-only controller metadata and connected automation summaries.
- `npm run test:admin-browser`: 14 isolated checks passed with zero runtime errors. Browser saves building details, generates floors/labs, renames a room, registers a camera, marks no-camera, saves/tests a controller, creates a timetable booking, generates a QR, updates automation, traverses ten admin routes plus profile, checks mobile layout, rejects bad signup keys and activates a viewer through profile. Uses a temporary database and generated credentials; existing user data/services are untouched. Evidence: `.local/admin-browser-verification.json` and `.local/screenshots/admin-management*.png` (ignored).
- `npm run build` and `npm run check` passed; syntax coverage is now 28 JavaScript files. `git diff --check` passed. PLAN.md hash remains unchanged.
- The first admin browser run passed the core flows but failed a test assumption that viewer registration redirects from `/rooms` to overview. The runner now explicitly navigates to overview after authenticating; the second full run passed. No browser runtime failure was observed.
- Live-session rollout is pending replacement of an existing invalid short admin key and API restart. The real local database was inspected read-only: non-demo accounts are stored as viewers. No role was silently changed, no user configuration was overwritten, and physical hardware was not tested.

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

CE-013 final executed results (14 November 2026): 99/99 application tests, 6 isolated institution browser checks without runtime errors, production/buildless build, 68 syntax checks and 12 client assets secret scan passed. Logs are ignored .local/institution-*.log. Actual local migration/account preservation and dedicated demo repeat were separately verified.

CE-014 final executed results:105/105 application tests (original transport test retained),6 multi-profile/two-tab browser checks without runtime errors,production/buildless build,72 syntax files and12 client assets secret scan passed. Running-stack viewer snapshot/readiness and unauthenticated denial verified separately. See HANDOFF.md for exact logs, rollout and unverified live/production limits.

CE-016 executed results:116full application tests passed,0skipped;17meter+energy targeted and10final meter tests passed. Five meter browser checks passed with actual OCR on synthetic video/images,not a physical meter. Production/buildless build,83syntax files and17client assets secret scan passed. Running Tesseract health/admin/viewer scopes/static pages verified separately. See HANDOFF for exact logs and remaining physical checks.


## CE-017 consumption and help verification

`node --test tests/consumption.test.js tests/energy.test.js` verifies interpolated upward/downward/asymmetric crossings, equality, timestamp-specific baseline changes, above-baseline vs anomaly tolerance, missing readings, aggregate gaps, epoch/duration breaks, missing actual/baseline values, source/date filters, CSV consistency/formula escaping and absent/recent/stale/simulated freshness. Eight new calculation tests join the seven existing energy tests.

Build with `npm run build`, then run `npm run test:consumption-browser`. The browser script uses the existing Chrome driver, isolated headless profile and temporary real MongoDB/institution. It checks accepted manual-reading provenance and tolerance separation; rendered red/green paths and palette; delayed hover, focus, Tab and Escape; native keyboard dialog opening, focus return, interval/summary/CSV consistency and related records; accepted-reading updates; offline/corrected-reading reconnect; 390px dialog/table layout and help interaction; future-range no-data and stale reading independent of connected transport. Synthetic fixtures do not establish physical metering or real-phone accessibility. Ignored evidence: `.local/consumption-browser.json`, `.local/consumption-browser.log`, `.local/screenshots/consumption-{chart,mobile}.png`.

Completed verification counts/results are recorded in the latest HANDOFF.md checkpoint. Remaining acceptance: real touchscreen/screen-reader review, actual source cadence/physical offline detection (the energy feed reports recorded intervals and a freshness heuristic), histories outside the 1,500-record read window, and field meter accuracy. No physical device actuation or savings verification is implied.

## Authentication debugging follow-up

The current browser fixture uses a real six-character password and eight-character Building Join Codes. The API suite tests those boundaries, forbidden role/building injection, correct/missing/wrong/disabled Administrator creation keys, write-only unique codes, rotation/disable/rename, account/member/hash preservation, persisted lock serialization, rollback and throttling. Session tests verify anonymous bootstrap 200, protected reads 401, logout revocation of old cookies, fresh CSRF and subsequent password-only login. Browser checks cover Administrator/Viewer signup, field labels, invalid key/code messages, sign-in/out, code rotation, linked building labels, pending-choice refresh and 390px layouts. No real user registration or password change is performed.

Console diagnostics: contentscript.js/ObjectMultiplex/app-init-liveness/background-liveness strings are absent from application sources; the exact injecting extension is unverified. Existing tests launch extension-free Chrome and collect runtime errors. React development StrictMode may issue an extra startup effect; cleanup aborts/ignores stale responses. React DevTools guidance is informational. Do not increase listener limits to hide an untraced warning.

## Embedded assistant verification (CE-019)

`npm test` includes three new assistant integration checks against temporary workspace databases: authenticated same-origin assets/session/direct answer and rejected foreign Origin; building-qualified identity/announcements/proposals when one account switches buildings; logout revocation. `npm run test:auth-browser` now also opens the actual signed-in launcher/iframe, waits for a completed direct-data reply, tests iframe Escape and the read-only Viewer panel at 390px. Screenshots `.local/screenshots/assistant-{desktop,mobile}.png` are ignored evidence.

The separate `npm test --prefix website-smart-bot` suite uses scripted Gemini and real website APIs; its legacy login fixture now submits only email/password. Final executed counts: website 136/136, assistant 59/59, integrated browser 10/10 with zero runtime errors. Build, 91 syntax files and 17 built-client asset secret scan passed. Initial embedding failure was an actual request-property collision with express-session, now corrected; earlier pending-response screenshot was replaced with a completed-answer capture. No real Gemini generation, user data changes or physical controls were exercised.
