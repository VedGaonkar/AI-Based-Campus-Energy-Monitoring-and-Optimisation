# Progress

Current implementation status and concise development history. The latest resume snapshot is in [HANDOFF.md](HANDOFF.md); task status is in [TASKS.md](TASKS.md).

## Current milestone

Backend core (tasks T1–T5 in TASKS.md), then the frontend (T6).

## Log

### 2026-11-13 — Session 1 start

- State found: branch `ved`; only documentation in the repository; nine Markdown files from the documentation-sync session uncommitted (pre-existing, not created by this session).
- Toolchain found: Node v24.19.0, npm 11.17.0, Python 3.14.7. No MongoDB server installed and Docker daemon not running.
- Decision: use `mongodb-memory-server` for tests and as a local development database fallback, because no MongoDB is available on this machine. A real `MONGODB_URI` is still supported.
- Next: scaffold `backend/`, then implement T1 onward.

### 2026-11-13 — Backend core implemented

- `npm install` hung: this network resets connections to `registry.npmjs.org`. Workaround used: `--registry https://registry.yarnpkg.com` (the lockfile still records npmjs URLs). Global npm configuration was not changed.
- Implemented `backend/`: configuration, models and indexes, session authentication, all routes, meter ingestion, baselines and anomalies, recommendations, occupancy, incidents, durable job worker, QR leases, overrides, room-level supply commands, simulated room-master adapter, demo seed and scenarios.
- Decisions: policy delays divide by `DEMO_TIME_SCALE` in demo mode while timestamps stay real; Socket.IO shares the Express session; errors use `{ error: { code, message, details } }`; `bcryptjs` is used for bcrypt hashing (no native build on Windows); the worker runs inside the API process by default (`WORKER_INLINE=true`) and can run separately.
- Verified: `npm test` in `backend/` — 62 tests pass (12 pure, 25 escalation, 25 ingestion and API).
- Verified live: `npm run db:memory` plus `npm start`; health, login, summary, rooms, incidents and recommendations respond; demo scenario "forgotten-lights" went first alert → escalation → simulated OFF in about 40 s, and "person-returns" restored the supply.
- Not done: vision/OCR service, SMTP, MQTT, physical adapter, frontend.
- Next: frontend (T6).
