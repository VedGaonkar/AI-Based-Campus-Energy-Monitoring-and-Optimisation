# Implementation Tasks

**Status as of 13 November 2026:** Planning/documentation only. The authoritative scope and completion criteria are in [PLAN.md](PLAN.md). No campus application source, manifests, seed fixtures, runtime configuration or application tests exist; all implementation milestones below are pending. Reusable scripts/tests under `.agents/skills/` do not count as application progress.

## Documentation baseline

- [x] Inspect all 67 existing Markdown files and distinguish project documentation from 57 reusable skill references/templates.
- [x] Align the nine supporting project documents with the plan and the actual planning-stage repository; preserve `PLAN.md` and reusable tooling.

Do not check off application work based on documentation alone. Each milestone needs working code and recorded validation of its exit condition.

## 24-hour implementation sequence

This follows [PLAN.md section 20](PLAN.md#20-time-boxed-24-hour-execution-plan). Hours are intended execution windows, not recorded effort or completed work.

| Status | Hours | Work | Exit condition |
| --- | --- | --- | --- |
| Pending | 0–2 | Confirm contracts/schema, scaffold JavaScript frontend/backend, sessions/roles and labelled seed data | Login and one room available through the API |
| Pending | 2–5 | Meter/timetable import, preview/validation, manual entry and interval calculations | Uploaded data produces correct consumption without duplication |
| Pending | 5–8 | Dashboard, contextual baselines/anomalies and recommendation rules | Explainable anomaly and actionable recommendation with assumptions visible |
| Pending | 8–11 | Observations, occupancy/protection policies, incidents, durable jobs and in-app alerts | Restart-safe first/second/final stages with invalidation checks |
| Pending | 11–14 | QR leases, warnings/extensions, manual override and room-master simulator | Authorised access, extension, cancellation and simulated control work |
| Pending | 14–17 | Approved camera clip/person inference and meter-image OCR adapters | Genuine integration exercised or limitation/fallback honestly declared |
| Pending | 17–20 | Integration tests/configuration UI, room/load approval, admin, assignments and outcomes | End-to-end workflow usable by each role |
| Pending | 20–22 | Failure handling, permissions, imports, calculations and timer verification | Core acceptance scenarios pass with evidence |
| Pending | 22–24 | Deterministic demos, walkthrough and documentation of actual commands | Reproducible demo with visible provenance and remaining limitations |

## Required implementation details

- [ ] Select compatible supported runtime/dependency versions, record model licences and commit lockfiles. Follow [setup order](PLAN.md#192-setup-procedure-for-the-coding-agent); proposed directories are not existing application paths.
- [ ] Define validated shared contracts, standard errors and scoped Socket.IO subscriptions before wiring consumers. Resolve the open [API](API.md) and [persistence](DATABASE.md) decisions.
- [ ] Implement one installation with rooms/zones, inventory, assignments and exactly one master per controlled room. Reject duplicate or shared mappings between independent rooms.
- [ ] Implement all three [CSV contracts](PLAN.md#64-import-contracts), invalid/duplicate reporting, provenance and idempotent commit; allow timetable edits, holidays, cancellations and ad hoc bookings.
- [ ] Validate accepted meter readings, epochs/registers/units, resets/rollovers, quality and gaps. Compute compatible intervals and partial-day coverage, reconcile sources and distinguish kWh from interval-average kW.
- [ ] Build robust/contextual or initial-rule baselines with sample-count/insufficient-data labels. Keep possible contributors and confirmed causes separate; assign manual investigation for unexplained anomalies.
- [ ] Implement recommendation accept/reject/schedule/complete/verify behaviour, owners, evidence and non-overlapping benefit estimates. Include tariffs, implementation quotes, uncertainty, net benefit and meaningful payback; do not claim estimates are verified savings.
- [ ] Separate occupancy, authorised-use protection, supply and appliance evidence. Validate camera/sensor coverage and freshness; unknown blocks vacancy cutoff, while fresh positive occupancy protects immediately.
- [ ] Implement persistent incident episodes, job leasing, outbox, backup routing and at-least-once/idempotency handling. Confirm vacancy (initial 15 minutes), first alert at t=0, escalation at +10 minutes, final recheck at +25 minutes.
- [ ] Invalidate stale actions on occupancy, protected booking/preparation period, QR lease/extension, override, policy change or source failure. Acknowledgement is not resolution; snooze expiry requires re-evaluation.
- [ ] Implement QR permission/hour/booking/duration/lockout checks, initial 120-minute maximum and 10-minute expiry warning. No-source expiry defaults to a staff task, not a vacancy claim. Keep any approved fixed-duration physical policy separate.
- [ ] Implement the simulator's room-master adapter, explicit ON/OFF commands, request IDs, short expiries, capabilities/status and verification labels. Add connection-test UI and a documented exact-model integration route; do not fabricate vendor endpoints or successful physical tests.
- [ ] Apply whole-room shared-cutoff approval, valid AC stop confirmation, restart delays and fault/maintenance/manual-isolation interlocks. Retain manual tasks for incompatible loads or unconnected hardware. Restore only eligible automation-disabled supply.
- [ ] Enforce simulation isolation on backend/gateway and preserve all source/data-mode labels. Accelerated time, replay and fixtures cannot trigger physical switching or notify real staff.
- [ ] Build Overview, Rooms, Incidents, Energy/imports, Recommendations, mobile QR Access and Admin screens from [frontend requirements](PLAN.md#16-frontend-screens-and-dashboard-requirements), including integration health, budget estimates, quotes and audit history.
- [ ] Apply [security requirements](SECURITY.md): role/room checks, scoped ingestion, sessions/CSRF, rate limits, secrets/redaction, bounded uploads, authorised footage and configurable evidence retention.
- [ ] Track source/OCR quality, gaps, false alerts, response times, command verification, recommendation outcomes and baseline age. Document remapping/recalibration after physical changes.
- [ ] Validate [TESTING.md](TESTING.md), including build/API/role/phone checks, worker restart/failure cases and one full incident-to-outcome run. Seed the eight demo scenarios with 30 days of visibly synthetic data.
- [ ] Record exact install/start/build/seed/test commands, enabled and unavailable integrations, credential prerequisites and verified results in the existing documentation once they exist.

## Inputs and unresolved decisions

Collect institution-provided meter/timetable data, authorised roles/assignments, tariff assumptions and generated server secrets. Optional live features additionally need footage permission/source details, actual model/weights/licence, OCR installation, provider/broker credentials and supported hardware documentation. See [PLAN.md section 18](PLAN.md#18-credentials-tools-and-information-to-collect).

The plan specifies workflows beyond its endpoint table: import preview/commit details, image correction/review, incident inspection/reassignment, recommendation scheduling/verification, user administration and inbox access still need precise contract mapping. Event/error schemas and some persistence details also remain open in [API.md](API.md) and [DATABASE.md](DATABASE.md). The problem-statement PDF is referenced by the plan but is not present locally; its content has not been independently revalidated during this audit.

Real installation additionally requires an electrician's feeder/load survey, exact breaker model/firmware/protocol, coverage/network testing, AC stop/restart approvals, local override and installed quotes. Physical installation is outside the hackathon deliverable. Reference prices and hypothetical payback in [PLAN.md section 23](PLAN.md#23-budget-purchasing-and-operating-cost-plan) are not purchase commitments or current installed quotes. Retention values and a security-reporting contact/process remain to be established.

## Scope and fallback priorities

If time is short, preserve real CSV/manual ingestion, analytics, recommendations and action tracking. Use in-app notifications, simulated masters, approved clips and manual meter imports instead of blocking on external onboarding, mains installation or uncalibrated OCR. Show unavailable integrations honestly.

Do not add multi-building/tenant operations, universal appliance detection, per-appliance controls, IR blasters, smart plugs, attendance/facial recognition or a production checkout. [Commercial options](PLAN.md#24-customer-segmentation-and-business-model), including later savings-performance/ESG work, are evaluation topics and do not expand the MVP. Use the authoritative [completion checklist](PLAN.md#26-completion-checklist-for-the-implementation-agent) before declaring the prototype complete.
