# Implementation Tasks

- [x] Repair demo room selection for legacy missing native policy; server-checked available-room options only, excluded reasons, matching creation checks. 17 demo tests and production/buildless build passed.

## CE-011 — Two-phone camera and acknowledged room-master demonstration

- [x] Scoped admin sessions/pairing, bounded camera transport and actual Python pixels (signed QR instrumented mode; positive-only HOG, unknown/injection kept distinct).
- [x] Extend existing room-master simulator with durable delivery/application ACK, expiry/reconnect and existing protections/persistent scheduler; no native fallback/live actuation.
- [x] Independent `demo/cctv-camera/` and `demo/circuit-board/` entry points/start commands, seven scenes/lock/local/master state, dashboard session/evidence/timeline/ACK panel.
- [x] 86 isolated application tests, 10 three-browser workflow checks, 14 existing admin browser checks, production/buildless build and 55 syntax checks passed. DEMO_SETUP.md/HTTPS example and affected contracts updated; current local rollout verification is recorded in HANDOFF.md/PROGRESS.md.
- [ ] Separate physical rehearsal: two phones, trusted reachable HTTPS/CA/firewall path, display focus/glare/moire/background/network-loss checks and consenting real teammate HOG test. These inputs were not supplied; no physical two-phone/electrical demonstration claimed.

## CE-010 — Existing smart equipment through Home Assistant

- [x] Add encrypted, destination-restricted Home Assistant connection and isolated simulator adapters; verify REST/WebSocket protocols and ordering.
- [x] Add persisted entity binding/capability review, per-target permission/test gates and native OFF command lifecycle.
- [x] Integrate native jobs with existing escalation, cancellation and breaker prerequisite checks; prevent fallback and outage backlog execution.
- [x] Add Connected Devices setup/discovery/details/commands UI, scoped APIs and simulator demonstrations. Nine isolated browser workflow checks passed.
- [x] Complete final full regression (70 tests), 40 syntax checks, production build, existing admin browser repeat (14 checks), managed local rollout and 7 read-only/runtime authentication checks. Setup guide and final continuity updated; app left running at localhost:5173.
- [ ] Separate physical acceptance: supply an always-on reachable HA host/version/origin/token, exact ordinary model/firmware/entity/load and genuine occupancy, then complete supervised OFF review/test before enabling live automation. No real equipment was supplied or operated.

- [x] Apply the user's six-color mint/forest/terracotta palette across the frontend and charts; verify exact browser colors, admin rendering and mobile layout. Production build passed.

## CE-009 — Administrator authentication and connected management panel

- [x] Fix invalid admin key fallback; require password plus key for administrator login and allow verified recovery of viewer accounts.
- [x] Add server-verified profile and distinct management routes for building, spaces, cameras, controllers, timetable, QR, users and automation logs.
- [x] Bulk floor/space generation, persistent mappings and documentation completed.
- [x] Final isolated regression: 45 tests passed. Build and 28 syntax checks passed. Dedicated admin browser run: 14 checks passed with no runtime errors.
- [x] Local-session rollout: user chose an eight-digit numeric key; validation/generation/forms updated, new key saved in ignored `.env`, managed API/worker/frontend restart succeeded, live administrator authentication and management API verified. Existing MongoDB/data preserved. 46 application tests passed.

## CE-008 — Stitch frontend redesign (13 November 2026)

- [x] Apply the supplied Campus Energy Stewardship visual system across the login screen and all eight authenticated pages, preserving connected APIs and access restrictions.
- [x] Bundle Karla, Barlow Condensed and Azeret Mono locally with OFL licenses; use copper charts, pale surfaces, condensed headings and rectangular controls.
- [x] Add room search, policy filtering, grid/list views, a room-status ledger with detail deep links, conservation directive links and a responsive room detail drawer.
- [x] Verify production build, 25 JavaScript syntax checks and 14 read-only browser checks, including all eight routes at 390/768/1280px and mobile navigation. No browser runtime errors.
- Scope: the attached master prompt is supporting context; its multi-building/backend expansion is not implemented by this redesign. PLAN.md is unchanged. Existing data, credentials and backend control logic are preserved.
- Local startup limitation: the current `.env` has an invalid short `ADMIN_INVITE_KEY`; use at least 16 characters or an empty value when next starting the backend. Its value was never printed or changed.

**Status as of 13 November 2026:** The core local prototype and CE-006 checkpoint are complete: 31 application checks, 13 browser checks, production build, syntax, built-app HTTP and documentation validation passed. [PLAN.md](PLAN.md) remains authoritative. Skill tests do not count as application progress. CE-007 physical/vision/external transports and wider field/production acceptance remain pending; no installation or production readiness is claimed.

## Documentation baseline

- [x] Inspect all 67 existing Markdown files and distinguish project documentation from 57 reusable skill references/templates.
- [x] Align the nine supporting project documents with the plan and the actual planning-stage repository; preserve `PLAN.md` and reusable tooling.

Do not check off application work based on documentation alone. Each milestone needs working code and recorded validation of its exit condition.

## 24-hour implementation sequence

### Active implementation tasks

| ID | Status | Depends on | Acceptance criteria |
| --- | --- | --- | --- |
| CE-001 | Complete | Documentation baseline | Pinned workspaces, strict contracts, real Mongo indexes/session store, scoped login/rooms and connected UI verified |
| CE-002 | Complete | CE-001 | Three CSV formats, durable preview/commit/retry, manual entry/review and epoch separation verified |
| CE-003 | Complete for MVP | CE-002 | Connected interval/expected chart, explainable anomalies and guarded recommendation outcome transitions verified |
| CE-004 | Complete for MVP | CE-001 | Durable incidents/jobs/inbox, first/second/final stages, database reconnect and cancellation verified |
| CE-005 | Complete for simulator | CE-004 | QR creation/extension/unknown expiry, overrides, explicit idempotent simulated master and interlocks verified |
| CE-006 | Complete for local MVP | CE-003, CE-005 | Connected admin/demo/browser/lifecycle, built-app HTTP and documentation checkpoint verified |
| CE-007 | Pending field/production work | CE-006 | Real phone/HTTPS and full role/accessibility review; model/licence/footage, external transports, exact hardware commissioning, retention/migrations and broader stress/failure acceptance |

The milestone windows below preserve the original sequence. Statuses reflect the verified MVP subset; the task IDs above and PROGRESS.md record actual execution. No physical integration is marked complete by simulator results.

This follows [PLAN.md section 20](PLAN.md#20-time-boxed-24-hour-execution-plan). Hours are intended execution windows, not recorded effort or completed work.

| Status | Hours | Work | Exit condition |
| --- | --- | --- | --- |
| Core verified | 0–2 | Confirm contracts/schema, scaffold JavaScript frontend/backend, sessions/roles and labelled seed data | Login and one room available through the API |
| Core verified | 2–5 | Meter/timetable import, preview/validation, manual entry and interval calculations | Uploaded data produces correct consumption without duplication |
| MVP verified | 5–8 | Dashboard, contextual baselines/anomalies and recommendation rules | Explainable anomaly and actionable recommendation with assumptions visible |
| In-app verified | 8–11 | Observations, occupancy/protection policies, incidents, durable jobs and in-app alerts | Restart-safe first/second/final stages with invalidation checks |
| Simulator verified | 11–14 | QR leases, warnings/extensions, manual override and room-master simulator | Authorised access, extension, cancellation and simulated control work |
| Fallback declared | 14–17 | Approved camera clip/person inference and meter-image OCR adapters | Genuine integration exercised or limitation/fallback honestly declared |
| MVP verified; wider role review pending | 17–20 | Integration tests/configuration UI, room/load approval, admin, assignments and outcomes | End-to-end workflow usable by each role |
| 31 checks passed | 20–22 | Failure handling, permissions, imports, calculations and timer verification | Core acceptance scenarios pass with evidence |
| Local demo verified; field checks pending | 22–24 | Deterministic demos, walkthrough and documentation of actual commands | Reproducible demo with visible provenance and remaining limitations |

## Required implementation details

- [x] Select compatible supported runtime/dependency versions, maintain the exact-version lockfile. No vision model is selected; record its licence before enabling one. Follow [setup order](PLAN.md#192-setup-procedure-for-the-coding-agent); the existing source map is recorded in ARCHITECTURE.md.
- [x] Define validated shared contracts, standard errors and scoped Socket.IO subscriptions before wiring consumers. Resolve the open [API](API.md) and [persistence](DATABASE.md) decisions.
- [x] Implement one installation with rooms/zones, inventory, assignments and exactly one master per controlled room. Reject duplicate or shared mappings between independent rooms.
- [x] Implement all three [CSV contracts](PLAN.md#64-import-contracts), invalid/duplicate reporting, provenance and idempotent commit; allow timetable edits, holidays, cancellations and ad hoc bookings.
- [x] Validate accepted meter readings, epochs/registers/units, resets/rollovers, quality and gaps. Compute compatible intervals and partial-day coverage, reconcile sources and distinguish kWh from interval-average kW.
- [x] Build robust/contextual or initial-rule baselines with sample-count/insufficient-data labels. Keep possible contributors and confirmed causes separate; assign manual investigation for unexplained anomalies.
- [x] Implement recommendation accept/reject/schedule/complete/verify behaviour, owners, evidence and non-overlapping benefit estimates. Include tariffs, implementation quotes, uncertainty, net benefit and meaningful payback; do not claim estimates are verified savings.
- [x] Separate occupancy, authorised-use protection, supply and appliance evidence. Enforce coverage-validation and freshness metadata; real coverage commissioning remains pending; unknown blocks vacancy cutoff, while fresh positive occupancy protects immediately.
- [x] Implement persistent incident episodes, job leasing, outbox, backup routing and at-least-once/idempotency handling. Confirm vacancy (initial 15 minutes), first alert at t=0, escalation at +10 minutes, final recheck at +25 minutes.
- [x] Invalidate stale actions on occupancy, protected booking/preparation period, QR lease/extension, override, policy change or source failure. Acknowledgement is not resolution; snooze expiry requires re-evaluation.
- [x] Implement QR permission/hour/booking/duration/lockout checks, initial 120-minute maximum and 10-minute expiry warning. No-source expiry defaults to a staff task, not a vacancy claim. Keep any approved fixed-duration physical policy separate.
- [x] Implement the simulator's room-master adapter, explicit ON/OFF commands, request IDs, short expiries, capabilities/status and verification labels. Provide capabilities/connection-test UI and an honest unavailable boundary; the exact physical model/adapter remains pending; do not fabricate vendor endpoints or successful physical tests.
- [x] Apply whole-room shared-cutoff approval, valid AC stop confirmation, restart delays and fault/maintenance/manual-isolation interlocks. Retain manual tasks for incompatible loads or unconnected hardware. Restore only eligible automation-disabled supply.
- [x] Enforce simulation isolation on backend/gateway and preserve all source/data-mode labels. Accelerated time, replay and fixtures cannot trigger physical switching or notify real staff.
- [x] Build Overview, Rooms, Incidents, Energy/imports, Recommendations, mobile QR Access and Admin screens from [frontend requirements](PLAN.md#16-frontend-screens-and-dashboard-requirements), including integration health, budget estimates, quotes and audit history.
- [ ] Complete production security review, credential rotation/revocation and retention enforcement. Core role/room checks, ingestion scope, sessions/CSRF, rate limits, redaction and bounded uploads are implemented/tested; footage/image storage is unavailable.
- [ ] Add operational trend/maintenance reporting for OCR review, false-alert findings, uptime and baseline age. Current raw source freshness, meter quality/gaps, incident timelines, command verification and recommendation outcomes are stored; physical recalibration and genuine OCR metrics remain unavailable.
- [ ] Complete the remaining [TESTING.md](TESTING.md) field/production matrix, real phone/HTTPS and all-role/accessibility walkthrough. Unit/API/restart checks, build, synthetic thirty-day seed and a full browser incident-to-outcome/QR/mobile run have passed; optional integrations retain declared fallbacks.
- [x] Record exact install/start/build/seed/test commands, enabled and unavailable integrations, credential prerequisites and verified results in the existing documentation once they exist.

## Inputs and unresolved decisions

Collect institution-provided meter/timetable data, authorised roles/assignments, tariff assumptions and generated server secrets. Optional live features additionally need footage permission/source details, actual model/weights/licence, OCR installation, provider/broker credentials and supported hardware documentation. See [PLAN.md section 18](PLAN.md#18-credentials-tools-and-information-to-collect).

Additional core workflow routes are now mapped in [API.md](API.md): import commit, manual reading review, stop confirmation, incident inspection/reassignment, recommendation scheduling/outcome review, account creation, inbox and opaque QR generation. Raw image/OCR processing, full account lifecycle, generated OpenAPI/cursor pagination, deeper baseline history/version management and production retention/migration details remain work. The source problem-statement PDF is not present locally and has not been independently revalidated.

Real installation additionally requires an electrician's feeder/load survey, exact breaker model/firmware/protocol, coverage/network testing, AC stop/restart approvals, local override and installed quotes. Physical installation is outside the hackathon deliverable. Reference prices and hypothetical payback in [PLAN.md section 23](PLAN.md#23-budget-purchasing-and-operating-cost-plan) are not purchase commitments or current installed quotes. Retention values and a security-reporting contact/process remain to be established.

## Scope and fallback priorities

If time is short, preserve real CSV/manual ingestion, analytics, recommendations and action tracking. Use in-app notifications, simulated masters, approved clips and manual meter imports instead of blocking on external onboarding, mains installation or uncalibrated OCR. Show unavailable integrations honestly.

Do not add multi-building/tenant operations, universal appliance detection, per-appliance controls, IR blasters, smart plugs, attendance/facial recognition or a production checkout. [Commercial options](PLAN.md#24-customer-segmentation-and-business-model), including later savings-performance/ESG work, are evaluation topics and do not expand the MVP. Use the authoritative [completion checklist](PLAN.md#26-completion-checklist-for-the-implementation-agent) before declaring the prototype complete.
