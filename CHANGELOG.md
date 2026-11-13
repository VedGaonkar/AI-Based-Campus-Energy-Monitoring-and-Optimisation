# Changelog

Record completed repository changes here. Planned work belongs in [TASKS.md](TASKS.md), and intended behaviour is defined by [PLAN.md](PLAN.md). No application release or implemented integration is claimed.

## Unreleased — 13 November 2026

### Documentation synchronisation

- Audited all 67 existing Markdown files: ten project documents and 57 reusable skill instructions/references/templates.
- Expanded the title-only README with scope, actual repository status, planned dependencies, setup prerequisites, documentation navigation and limitations. Converted its original UTF-16 encoding to UTF-8 for text review and maintenance.
- Populated the eight previously empty documents: `AGENTS.md`, `API.md`, `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `TASKS.md`, `TESTING.md` and this changelog.
- Aligned component responsibilities, planned contracts/data, one-master-per-controlled-room rules, evidence labels, durable escalation, QR access, simulation isolation, security and acceptance work with the master plan.
- Distinguished requirements from implementation throughout. No campus application source, runtime configuration, manifests, seed data or application tests exist yet; tool scripts/tests under `.agents/skills/` are unrelated to application progress.
- Recorded unresolved route/schema/persistence choices, deployment inputs and commissioning requirements without inventing interfaces, commands, hardware results or passing tests.
- Clarified that generic design-skill stack/path examples do not override the project's JavaScript/React/Vite architecture. Preserved all 57 reusable Markdown files, including bundle-local duplicate references, and left `PLAN.md` unchanged.

This update changes documentation only. Application implementation and the [acceptance checks](TESTING.md) remain pending.
