# AI-Based Campus Energy Monitoring and Optimisation

**Two-phone demo:** [DEMO_SETUP.md](DEMO_SETUP.md) connects a video-only phone camera, actual Python/OpenCV pixels, existing persistent escalation and a second phone's acknowledged virtual room master. Open `/phone-demo` as admin and pair the independent `/demo/cctv-camera/` and `/demo/circuit-board/` apps. Instrumented QR vision, conservative person-positive inference and explicit scenario injection have separate labels. Physical phones/HTTPS/LAN filming still need a supervised rehearsal; no live switching or measured savings is claimed. Optional standalone entry commands: `npm run demo:camera` and `npm run demo:classroom`, using the existing backend.

## Existing smart equipment

**Connected devices** now supports an isolated simulator and a server-side Home Assistant connector for reviewed existing light/fan/switch/climate native OFF targets. Configure a connection, test it read-only, discover/map exact entities, review the load, conduct an explicit OFF test and then permit automation. The existing persistent escalation and room protections remain authoritative; a failed native OFF never triggers room-master fallback. No appliance ON restoration, universal brand/assistant support or measured savings is implied.

Follow [HOME_ASSISTANT.md](HOME_ASSISTANT.md) for exact setup, supported routes, token encryption/revocation, network allowlists, per-target/live gates, simulator demonstration, versions/licences and remaining physical acceptance work. Home Assistant is not installed automatically. Live OFF is disabled by default; physical room-master controls remain uncommissioned.

Validation for this feature: `npm test`, `npm run check`, `npm run build`, then `npm run test:devices-browser`. The device browser runner uses temporary databases/credentials and isolated simulation, not a saved live gateway.

## Administrator access and setup

`ADMIN_INVITE_KEY` is the only server-side invitation/enrollment key, currently exactly eight digits. Set it in the repository-root ignored `.env` (the folder containing package.json), or in the backend's deployment environment. An explicitly set process variable takes precedence over `.env`, including an empty value. No database setting, seed value, frontend constant or Vite variable overrides it. Duplicate `.env` key entries are rejected with a configuration error. `.env.example` contains a placeholder; `npm run setup` generates a random key only for a new file and preserves existing configuration.

When configured, administrator login requires the account password plus the current key. Wrong keys reject signup/activation instead of silently creating viewers. If missing/blank, invitation-based admin registration and viewer-to-admin activation return `ADMIN_ACCESS_DISABLED` with setup instructions; existing active users, including administrators, can still log in using their password without submitting an invitation key. This shared enrollment secret is not per-user MFA.

Editing `.env` does **not** change a running backend or existing authenticated session. Stop/restart the full managed stack after changing it:

```bash
npm run stop
npm run dev
```

For separately supervised services, restart both `npm start` and `npm run worker`. If a stale value was set in PowerShell, remove that process override with `Remove-Item Env:ADMIN_INVITE_KEY -ErrorAction SilentlyContinue` before starting again; also check your process manager's environment. Never print the key or put it in a `VITE_*` variable. A frontend rebuild alone does not rotate server configuration. Sign out and test a new sign-in: the new key must work and the previous key must fail.

If your existing account shows Viewer, open **My profile** and verify your account password plus the valid key to activate admin access. You can also supply both during sign-in. The server audits the role change; the profile displays the role verified by `/auth/me`.

**Admin management** at `/admin` has dedicated Building setup, Rooms & corridors, Camera mapping, Smart controllers, Timetable, Room QR & overrides, Automation & control logs, Users & permissions and Advanced settings pages. Building setup persists organisation details, generates floors and supports named spaces with stable identities. Existing rooms can be assigned to floors without replacing their records. Hardware transport remains simulated or unavailable until commissioned.

To explicitly generate a new key while preserving other existing settings:

```bash
npm run setup -- --generate-admin-key
```

Read the generated key only from `.env`, restart the managed stack, and sign in again. This command replaces duplicate key entries with a single newly generated value; it does not change accounts/passwords. Explicit deployment process variables still take precedence. Verify a built frontend with `npm run build` followed by `npm run check:client-secrets`; the scan prints only results, never secret values.

`npm run test:admin-browser` runs the admin registration/login/profile/building/floors/rooms/cameras/controllers/timetable/QR/automation workflow against an isolated temporary database with generated credentials and the built frontend. Run `npm run build` first; the check requires installed Chrome/Edge or `BROWSER_EXECUTABLE`.

A local single-building energy prototype for a 24-hour hackathon. It combines building meter readings, room timetables and available occupancy evidence to identify avoidable use, assign action and track outcomes.

[PLAN.md](PLAN.md) is the authoritative implementation plan. [PROGRESS.md](PROGRESS.md) and [HANDOFF.md](HANDOFF.md) record current implementation and session recovery details.

## Current status

The repository now contains a React/Vite frontend, Express API, MongoDB/Mongoose persistence, a separate durable worker, shared validated contracts, deterministic synthetic seed data and application tests. Reusable `.agents/skills/` tooling remains independent of the application.

Implemented workflows include session login and room-scoped roles, CSV preview/commit and manual meter entry, timetable editing/cancellation, interval/baseline analytics, anomaly investigation, recommendation decisions/outcome review, in-app notifications, persistent vacancy escalation, QR leases/extensions, staff overrides and guarded room-level simulation. Physical room hardware, general CCTV/RTSP inference, OCR, MQTT and SMTP remain unavailable integrations; the separate phone-demo pixel pipeline is implemented; the application does not claim they work. Further acceptance coverage and installation work remain documented in TASKS.md.

## Intended prototype

- Import building meter readings through CSV/manual entry and room timetables through CSV/editing. Calculate compatible energy intervals, show data coverage and detect explainable anomalies.
- Recommend scheduling and efficiency changes with owners, evidence, estimated kWh/rupee benefits and outcome tracking.
- Use validated camera/presence observations where available; offer authenticated QR access leases where rooms have no occupancy source.
- Persist incidents and escalation: first alert after confirmed vacancy and protection checks, second alert 10 minutes later, final eligibility check after another 15 minutes.
- Default to alert-only room policies and simulated hardware. One independently controlled Wi-Fi smart master breaker per controlled room switches all its approved ordinary loads together.

Building meter readings do not establish unmetered room consumption. Camera observations, equipment estimates, simulated fixtures and measured data must retain distinct source labels. Unknown occupancy blocks vacancy-based automatic shutdown. QR expiry alone does not establish vacancy.

Physical installation is outside the hackathon deliverable. A qualified electrician must approve the feeder, downstream protection and every connected load before physical operation. Cameras, sensors, networking and essential supplies remain available when ordinary room supply is OFF. AC stop/restart requirements can block the entire room cutoff.

The scope excludes multiple-building operation/comparisons, new per-appliance actuators, smart-plug purchases, per-button modules, AC IR blasters, facial recognition and attendance monitoring. The approved optional Home Assistant extension permits native OFF for reviewed existing smart appliances; room-master controls remain independent. Core functionality requires neither an LLM nor paid cloud services. See [scope and exclusions](PLAN.md#1-product-objective-and-agreed-decisions).

## Local setup and startup

The selected design uses React/Vite with JavaScript, Tailwind CSS, React Router, Recharts and Socket.IO; an Express/Node.js backend; MongoDB/Mongoose; and a separate persistent Node worker. Python is reserved for the optional FastAPI/OpenCV/person-detection/Tesseract vision and OCR service. See [the full stack and dependency choices](PLAN.md#9-recommended-software-stack).

Use Node 26.13.1 (recorded in `.node-version`) and npm. A workspace-local Node runtime is also pinned for npm scripts; the system Node used during development was older than the router's minimum. MongoDB is the real database, including during tests. The local development helper starts MongoDB 8.2.6 with persistent data under ignored `.local/` when the default local URI is not already reachable. Its first download is about 781 MB and needs network access. An existing MongoDB URI can be supplied instead; Docker is not required.

Run from the repository directory containing this README:

```bash
npm ci
npm run setup
npm run dev
```

Open `http://localhost:5173`. Setup creates an ignored `.env` with generated secrets, an `ADMIN_INVITE_KEY` and a local `DEMO_PASSWORD`; existing configuration is preserved. Demo account names are `admin@campus.test`, `hod@campus.test`, `technician@campus.test`, `teacher@campus.test` and `viewer@campus.test`. Read the generated password locally; it is not published in documentation or embedded in browser code. Never commit `.env`.

Development starts the API at `http://localhost:5000`, worker and Vite. The initial database is seeded once; subsequent starts preserve it. `npm run seed` idempotently adds missing synthetic records/accounts without resetting existing policies/passwords. Use `npm run stop` from another terminal for explicit owned-service cleanup, or Ctrl+C. A reachable existing local MongoDB is reused; an existing Campus Energy Vite server on port 5173 is also reused. Reused services are never stopped by the helper. Ignored `.local/dev-session.json` records process ownership; verify it rather than assuming all local listeners belong to this run.

The official npm registry reset connections in the implementation environment; `npm install --registry=https://registry.npmmirror.com` was the per-command workaround. No global npm setting was changed. Normal network environments can use the standard registry; the lockfile records the selected package artifacts and integrity hashes.

For the built application with a reachable configured MongoDB, run `npm run build`, `npm start` and `npm run worker` (the last two in separate terminals). The API serves `frontend/dist/` on port 5000. Build output is ignored. Development preview is loopback-only; a real phone requires a deliberately configured reachable HTTPS URL/reverse proxy and matching `PUBLIC_APP_URL`/origin. A real phone/network installation has not been verified.

Verification commands: `npm test`, `npm run test:unit`, `npm run check`, `npm run build`. Browser smoke uses `node scripts/browser-smoke.mjs` with the development stack running and an installed Chromium browser; set `BROWSER_EXECUTABLE` if necessary. See [TESTING.md](TESTING.md) for recorded results and limits.

Review `.env.example` and [PLAN.md section 18](PLAN.md#18-credentials-tools-and-information-to-collect). Keep `DEMO_MODE=true`, `ALLOW_PHYSICAL_CONTROL=false`, `DEVICE_ADAPTER=simulator` and `NOTIFICATIONS_MODE=in_app`. Physical enablement is rejected because no commissioned physical adapter is installed. Set `DEMO_TIME_SCALE=1` when demo mode is disabled. Persisted timestamps are UTC; pilot calendar/display is `Asia/Kolkata`.

The intended demo serves the built frontend from the Node server on a continuously running local host. Phone QR access needs a reachable application URL. Private CCTV and breaker connectivity require a reachable local gateway; storing an RTSP URL does not give a cloud host network access.

## Documentation map

| File | Purpose |
| --- | --- |
| [PLAN.md](PLAN.md) | Authoritative scope, workflows, contracts, milestones, budgets and acceptance criteria |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Planned components, boundaries, evidence and room-master design |
| [API.md](API.md) | Planned application/internal endpoints and event contracts |
| [DATABASE.md](DATABASE.md) | Planned collections, indexes and consistency rules |
| [SECURITY.md](SECURITY.md) | Required access, privacy, integration and physical-control safeguards |
| [TASKS.md](TASKS.md) | Implementation backlog and the 24-hour milestone sequence |
| [TESTING.md](TESTING.md) | Planned acceptance checks and honest verification status |
| [AGENTS.md](AGENTS.md) | Repository instructions for future developers and AI agents |
| [CHANGELOG.md](CHANGELOG.md) | Documentation changes and eventual implementation history |
| [PROGRESS.md](PROGRESS.md) | Current task, completed increments, verification and concise history |
| [HANDOFF.md](HANDOFF.md) | Immediately actionable session-resume snapshot |

Supporting documents identify implemented behaviour separately from remaining requirements. Generic skill references under `.agents/skills/` retain their own reusable purpose; they do not select the application architecture. Exact installed versions are recorded in package manifests/lockfile. Current framework guidance was checked through Context7 and the official [Vite](https://vite.dev/guide/), [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite), [Mongoose](https://mongoosejs.com/docs/guide.html) and installed connect-mongo documentation.

## Demonstration and rollout

The seed supplies 30 calendar days of visibly synthetic intervals (only completed intervals on the current day), three rooms and test roles. Open a room to start normal-class, forgotten-lights, person-return or camera-offline fixture replay. Forgotten-lights demonstrates 15 seconds of vacancy confirmation, a first alert, escalation 10 seconds later and a final simulated recheck 15 seconds after that at the default 60× scale. In-app notifications are persisted; nobody is emailed. QR access uses its normal authenticated form; analytics and recommendation scenarios use seeded data. These are explicit fixtures, not genuine vision/OCR output.

Installation estimates require one suitable breaker quote per controlled room plus feeder/protection, labour, sensing, connectivity and commissioning costs. [Budget assumptions](PLAN.md#23-budget-purchasing-and-operating-cost-plan) are planning references, not current purchase quotes or verified payback. [Commercial options](PLAN.md#24-customer-segmentation-and-business-model) are future evaluation work; checkout, tenant management and ESG reporting are not MVP requirements.

Remaining work includes field vision coverage/OCR/model validation, actual device/notification transports, broader field/production acceptance, full account lifecycle, baseline history/version management, retention/migrations and deployment/commissioning. Manual reading correction, reset epochs and normal-stop confirmation are implemented with evidence/audit records. The engine rebuilds at most 20,000 readings and returns at most 1,500 chart intervals; it is a prototype, not a production utility ledger. Import commits are repeat-safe row operations, not transactions. Tariffs and seed equipment approvals are hypothetical and cannot authorise physical installation.
