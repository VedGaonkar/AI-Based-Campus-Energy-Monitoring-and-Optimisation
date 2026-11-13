# Agent and contributor instructions

Working rules for AI coding agents and human contributors in this repository.

## Source of truth

[PLAN.md](PLAN.md) is the authoritative plan. If any other document disagrees with it, PLAN.md wins; fix the other document. Do not change PLAN.md unless the task explicitly asks for it.

Read PLAN.md before writing code, then the document for the area you are touching:

| Area | Document | Plan sections |
| --- | --- | --- |
| Components and boundaries | [ARCHITECTURE.md](ARCHITECTURE.md) | §10, §11, §12, §15 |
| Endpoints and contracts | [API.md](API.md) | §6.4, §12.3, §13 |
| Collections and indexes | [DATABASE.md](DATABASE.md) | §14 |
| Security and safety | [SECURITY.md](SECURITY.md) | §3.2, §17 |
| Verification | [TESTING.md](TESTING.md) | §21, §22 |
| What to build next | [TASKS.md](TASKS.md) | §19.2, §20, §26 |

## Current repository state

- Only documentation exists. No application code, package manifests, lockfiles or tests have been created.
- `.agents/skills/` contains third-party design skill packs (banner-design, brand, design, design-system, slides, ui-styling, ui-ux-pro-max). They may help with UI work. They are not part of the application; do not edit them or treat them as project requirements.
- Inspect the repository before scaffolding and preserve unrelated files.

## Non-negotiable design rules

1. **One building.** Do not add multi-building, multi-campus or multi-tenant structures.
2. **One Wi-Fi smart master breaker per controlled room.** The application sends one room-level ON/OFF request. Do not add per-appliance controls, AC IR blasters, smart plugs, per-button modules or an ESP32 relay as an alternative actuator. Appliance inventory is for observation, estimates and shared-cutoff eligibility only.
3. **The backend is the policy authority.** The browser never controls a breaker, talks to a camera, or decides to cut power.
4. **Label evidence honestly.** Every reading, series, recommendation and outcome carries a source label: Metered, Camera-observed, Sensor-reported, Estimated, Simulated or Unknown. Preserve `dataMode` end to end.
5. **Simulated is never verified.** A simulated OFF must not appear as a physical shutdown. Never return a hardcoded "person detected" or a faked successful integration.
6. **Conservative control.** Rooms start alert-only. Positive occupancy cancels pending shutdown. Unknown occupancy blocks automatic shutdown. Use explicit ON and OFF, never a toggle.
7. **An incompatible downstream load blocks the whole room cutoff** and creates a manual task, because software cannot isolate one load behind the master.
8. **Never auto-restore** a supply that is fault-tripped, maintenance-locked or manually isolated. Only restore a supply the application deliberately opened.
9. **No room-level kWh from a building meter or CCTV.** Contributors to a spike are "possible", never measured attribution.
10. **Escalation is persistent.** Timing comes from stored `dueAt` in MongoDB, not `setTimeout`, browser storage or a frontend countdown. Reload current state before every stage.
11. **Physical control is off by default.** `DEMO_MODE` and `ALLOW_PHYSICAL_CONTROL` are enforced on the server; demo, replay and accelerated time can never authorise a physical action.
12. **No LLM API or paid cloud service** is required for core functionality.

## Technology constraints

- Web application in JavaScript (React, Vite, Express). Python only for the vision and OCR service.
- Use an Active LTS Node.js version compatible with the installed Vite, currently supported dependency versions, and committed lockfiles.
- Follow the current official Tailwind Vite installation guide; do not mix in Tailwind v3 setup steps.
- Validate at service boundaries with Zod (Node) and Pydantic (Python).
- Persist timestamps in UTC; interpret calendars and display in Asia/Kolkata.
- Before adopting a person-detection model, read and record its licence obligations.
- Never put SMTP, meter, camera, broker or controller credentials in `VITE_` variables or browser code.

## Build order

1. Scaffold, contracts, schemas, authentication and seed data.
2. CSV and manual ingestion with interval calculations.
3. Dashboard, baseline and anomaly logic, recommendations.
4. Observations, incidents, persistent jobs and in-app alerts.
5. QR leases, overrides and the simulated room master.
6. Vision and OCR as separate adapters.
7. Optional MQTT, Home Assistant and physical room-master adapter, disabled by default and behind connection tests.

If time is short, keep ingestion, analytics, recommendations and action tracking, and fall back as described in PLAN.md §20. Do not drop recommendations to spend the time on appliance detection.

## Documentation upkeep

- Do not document a command, endpoint, feature or test result that does not exist. Mark planned work as planned.
- When you implement something, update the affected document in the same change: [TASKS.md](TASKS.md) for progress, [API.md](API.md) and [DATABASE.md](DATABASE.md) for contract or schema changes, [README.md](README.md) for real start, build, seed and test commands, and [CHANGELOG.md](CHANGELOG.md) for notable changes.
- If the implementation must differ from PLAN.md, record the discrepancy explicitly instead of silently diverging.
- Do not create new Markdown files when an existing one already owns the topic.

## Open questions in the plan

These are not decided by PLAN.md. Raise them rather than guessing silently; if you must choose, record the choice.

- Which person-detection model to use (§9 only requires an acceptable licence).
- How `DEMO_TIME_SCALE` accelerates time while job timing stays driven by stored `dueAt` (§15.1, §22).
- How session authentication is shared with the Socket.IO handshake (§13.1 requires role and room checks on every subscription).
- The shape of the "standard error responses" (§13).
- Which smart-breaker model and integration route the physical adapter targets (§11.4).
