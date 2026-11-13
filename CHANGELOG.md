# Changelog

Notable changes to this project. Newest first. No version has been released; the application has not been implemented yet.

## Unreleased

### Documentation

- Filled the previously empty README, AGENTS, ARCHITECTURE, API, DATABASE, SECURITY, TESTING, TASKS and CHANGELOG documents so they align with PLAN.md. All describe planned behaviour and state that no code exists yet.

## 2026-11-13

### Changed

- Revised PLAN.md to the confirmed control architecture: one Wi-Fi smart master circuit breaker per controlled room. Removed per-appliance switching, retrofit relay modules, smart plugs and AC IR control from the design, and added the room-master adapter contract, AC handling without IR hardware, the `roomBreakers` collection, the room-level supply-command endpoint and the matching acceptance checks.

### Added

- PLAN.md, the complete implementation plan for the 24-hour hackathon prototype.
- Empty placeholder documents: AGENTS, API, ARCHITECTURE, DATABASE, SECURITY, TASKS, TESTING and CHANGELOG.
- Third-party design skill packs for AI coding agents under `.agents/skills/`.
- Initial README with the project title.
