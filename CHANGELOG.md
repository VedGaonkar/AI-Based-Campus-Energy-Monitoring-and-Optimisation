# Changelog

## CE-018 - simplified authentication

Email/password sign-in now opens existing memberships automatically or asks after authentication when several exist. Administrator registration requires the configured server registration key and creates an empty building; Viewer registration uses its Building Join Code. Added secure write-only code rotation/disabling and retired old admission endpoints while preserving account/member/data identities and styling. Administrator creation retains its server registration-key gate; sign-in remains email/password only. Added safe session bootstrap, guarded logout and field-specific validation. Minimums are six characters for passwords and eight for join codes. Updated tests, configuration examples and documentation.

Record completed changes here. Planned work belongs in [TASKS.md](TASKS.md), approved behaviour in [PLAN.md](PLAN.md), current state in PROGRESS.md/HANDOFF.md. The local prototype is not a production release or commissioned physical integration.

## Unreleased — 13 November 2026

### Local prototype implementation

- Established PROGRESS.md/HANDOFF.md and task IDs, preserving the nine pre-existing modified documents and the original PLAN.md.
- Added pinned JavaScript workspaces, ignored secret generation, real MongoDB development/test support, server sessions, scoped roles, strict contracts and protected room mappings.
- Implemented durable CSV preview/commit, manual meter entry/review, meter epochs, interval/gap/quality calculations, explainable baselines/anomalies and recommendation decisions/outcome review with disclosed uncertainty.
- Connected React screens for overview, rooms/load policies, energy/imports, timetable, incidents/inbox, recommendations, QR access and admin/assignments/budget/account creation. Lazy-loaded charts; retained separate occupancy, authorised use, supply and estimated load evidence.
- Implemented persistent worker jobs/outbox, database-reconnect recovery, invalidation, lease warnings/expiry, overrides, explicit idempotent simulated room-master actions and AC/fault/restoration interlocks. All physical enablement remains rejected; optional vision/OCR/MQTT/SMTP are unavailable honestly.
- Fixed two verification findings: bulk seed UUID defaults silently dropping rows, and Zod optional defaults resetting omitted PATCH fields. Added regression coverage for actual seed persistence, booking/policy preservation, manual review, scoped ingestion and normal-stop/restart behaviour.
- Verified 31 unit/API/database/config checks, the production build, JavaScript syntax and a complete 13-check Chrome workflow at desktop/narrow viewport, including escalation → simulated OFF → occupancy restoration and QR leases. Screenshots/report are ignored local artifacts; no real phone/physical installation is claimed.
- Added explicit development ownership/stop handling and built-app HTTP/documentation validation. No staging, commits, pushes, publication or deployment were performed by the implementation agent. External commit `2434a21` advanced HEAD during work; it was preserved.

### Documentation synchronisation

- Audited all 67 existing Markdown files: ten project documents and 57 reusable skill instructions/references/templates.
- Expanded the title-only README with scope, actual repository status, planned dependencies, setup prerequisites, documentation navigation and limitations. Converted its original UTF-16 encoding to UTF-8 for text review and maintenance.
- Populated the eight previously empty documents: `AGENTS.md`, `API.md`, `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `TASKS.md`, `TESTING.md` and this changelog.
- Aligned component responsibilities, planned contracts/data, one-master-per-controlled-room rules, evidence labels, durable escalation, QR access, simulation isolation, security and acceptance work with the master plan.
- Distinguished requirements from implementation throughout. No campus application source, runtime configuration, manifests, seed data or application tests exist yet; tool scripts/tests under `.agents/skills/` are unrelated to application progress.
- Recorded unresolved route/schema/persistence choices, deployment inputs and commissioning requirements without inventing interfaces, commands, hardware results or passing tests.
- Clarified that generic design-skill stack/path examples do not override the project's JavaScript/React/Vite architecture. Preserved all 57 reusable Markdown files, including bundle-local duplicate references, and left `PLAN.md` unchanged.

The preceding documentation synchronisation changed documentation only. Subsequent implementation/results are recorded above; wider field/production checks remain in [TESTING.md](TESTING.md).


## CE-017 - consumption evidence and contextual explanations

Added per-interval baseline chart colouring with calculated crossings, labelled baseline/reference markers, honest gap/no-data handling, original-resolution details and matching CSV export. Source/range filters, provenance, last accepted time, disclosed freshness and average-power labels share existing accepted readings. Completed recalculation now invalidates existing live snapshots. Added reusable hover/focus/tap help for unfamiliar metrics and evidence states. Preserved approved base palette, control/alert policies, workspace isolation and user data. Verification and limits are in TESTING.md and HANDOFF.md.
