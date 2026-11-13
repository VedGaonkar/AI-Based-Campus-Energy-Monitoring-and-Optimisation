# Handoff

Latest session-resume snapshot. Replace stale facts; history belongs in [PROGRESS.md](PROGRESS.md).

## Current objective

Build the one-building campus energy prototype in PLAN.md. Active milestone: backend core, then frontend.

## Confirmed decisions

- One building; exactly one Wi-Fi smart master breaker per controlled room; no per-appliance control, smart plugs or AC IR.
- Physical switching simulated by default; no physical adapter exists.
- JavaScript web stack; Python only for vision and OCR.
- Demo time acceleration divides policy delays by `DEMO_TIME_SCALE`; timestamps stay real (`backend/src/clock.js`).

## Repository state

- Branch `ved`. Nothing committed this session.
- Pre-existing uncommitted changes: the nine documentation files from the documentation-sync session.
- This session added: `PROGRESS.md`, `HANDOFF.md`, `.gitignore`, `backend/` (source, tests, lockfile).

## Completed and verified

- Backend source written for all planned areas (not yet run end to end).
- `node --test test/energy.test.js`: 12 pure calculation and policy tests pass.

## In progress

Database-backed tests (`backend/test/*.test.js`) for escalation, ingestion and the API. The server has not been booted yet.

## Verification

- Run from `backend/`: `npm test`.
- Not yet run: database tests, server boot, seed.

## Blockers

- `registry.npmjs.org` is unreachable on this network. Workaround: add `--registry https://registry.yarnpkg.com` to `npm install`. The lockfile still records npmjs URLs.
- No MongoDB installed and Docker is not running. Fallback: `npm run db:memory` (in-memory server persisted under `backend/.data`), and tests use `mongodb-memory-server`.

## Running processes

None.

## Next actions

1. Write and run `backend/test/escalation.test.js`, `ingest.test.js`, `api.test.js`; fix failures.
2. Boot: `npm run db:memory`, then `npm start`; check `/api/v1/health` and login.
3. Scaffold `frontend/` (Vite, React, Tailwind) and build the screens.
4. Update API.md, DATABASE.md, ARCHITECTURE.md, SECURITY.md, TESTING.md, README.md, TASKS.md, CHANGELOG.md to match the code.

## Resume instructions

Read AGENTS.md, this file, PROGRESS.md and TASKS.md, then `git status`. Do not re-scaffold `backend/`.
