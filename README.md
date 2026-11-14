# AI-Based Campus Energy Monitoring and Optimisation

## Render/Vercel authentication and deployment (CE-024)

See [Render + Vercel + Atlas instructions](deployment/RENDER_VERCEL.md) for exact required server/build variables, deployment order, proxy/session setup, database transfer and persistent demonstration accounts. Existing passwords and memberships are preserved; no seed runs at startup. Normal login uses stored hashes, not demo environment values. Production still requires independent 32+ character session/service secrets; demo provisioning passwords validate only on an explicit seed (6+ development/test, 20+ production). `npm run configure:vercel -- https://<api>.onrender.com` prepares three local configurations without publishing. Main Vercel uses a same-origin HTTP proxy and direct Render real-time session tickets.

**Quicker local demonstration:** open `/presenter`, review a room in **Prepare a room for simulation** if needed, create the session and click **Prepare both phone links**. The links pair their apps automatically; camera Start/permission stays explicit. Existing active sessions reopen automatically, advanced settings are collapsible and fullscreen keeps the classroom QR visible. [Short walkthrough](DEMO_SETUP.md#short-demo-flow-ce-023). Actual protected loads and backend safety checks remain enforced.

**Optional sustainability / ESG reporting:** open **Sustainability / ESG** after signing in; an Administrator can enable the module. It reports accepted electricity, estimated CO2, comparable-period changes, source coverage, manual participation evidence and a visible governance documentation rubric. It is internal reporting, not a certified rating. Includes append-only factor history and Administrator JSON snapshot exports. [Methodology and permissions](SUSTAINABILITY.md). Billing/payment integration is outside this optional commercial reporting module.

**Two-phone demo:** [DEMO_SETUP.md](DEMO_SETUP.md) connects a video-only phone camera, actual Python/OpenCV pixels, existing persistent escalation and a second phone's acknowledged virtual room master. Open the separate authenticated `/presenter` URL as admin and pair the independent `/demo/cctv-camera/` and `/demo/circuit-board/` apps. Instrumented QR vision, conservative person-positive inference and explicit scenario injection have separate labels. Physical phones/HTTPS/LAN filming still need a supervised rehearsal; no live switching or measured savings is claimed. Optional standalone entry commands: `npm run demo:camera` and `npm run demo:classroom`, using the existing backend.

**Deployment preparation:** [DEPLOYMENT.md](DEPLOYMENT.md) provides the reviewed Linux Docker Compose/Caddy topology, public origins, environment placeholders, deployment order, backup/migration and remaining host checks. Main application: `npm run build:main` -> `frontend/dist`. Independent camera: `npm run build:phone-camera` -> `dist/phone-camera`. Independent classroom: `npm run build:classroom` -> `dist/virtual-classroom`. `npm run build` builds all entry points. Normal dashboard navigation/overview no longer links to demonstration setup. Room/device registration remains in Management. No hosting, tunnel or physical-phone rehearsal was performed.

## Existing smart equipment

**Connected devices** now supports an isolated simulator and a server-side Home Assistant connector for reviewed existing light/fan/switch/climate native OFF targets. Configure a connection, test it read-only, discover/map exact entities, review the load, conduct an explicit OFF test and then permit automation. The existing persistent escalation and room protections remain authoritative; a failed native OFF never triggers room-master fallback. No appliance ON restoration, universal brand/assistant support or measured savings is implied.

Follow [HOME_ASSISTANT.md](HOME_ASSISTANT.md) for exact setup, supported routes, token encryption/revocation, network allowlists, per-target/live gates, simulator demonstration, versions/licences and remaining physical acceptance work. Home Assistant is not installed automatically. Live OFF is disabled by default; physical room-master controls remain uncommissioned.

Validation for this feature: `npm test`, `npm run check`, `npm run build`, then `npm run test:devices-browser`. The device browser runner uses temporary databases/credentials and isolated simulation, not a saved live gateway.

## Accounts and Building Join Codes

Sign in with **Email address** and **Password** only. One active building membership opens automatically. Existing users with multiple legitimate memberships choose an authorised building after password verification. No registration code is required on later logins.

Choose **Administrator** registration to create a new empty building: full name, email, password/confirmation, building name, a strong **Set Building Join Code** value you choose, and the **Administrator registration key** matching the server ADMIN_INVITE_KEY. Matching an existing name never grants access to it. Choose **Viewer** registration to supply full name, email, password/confirmation and the building administrator's Building Join Code. The backend resolves the building and grants only Viewer membership.

Manage the write-only code in **Admin management / Building setup** or **My profile**. Codes are case-sensitive, 8-64 ASCII letters/numbers/optional hyphen/underscore, with letters, numbers and at least six distinct characters. Share privately. The original cannot be retrieved; replace or disable it. Rotation blocks the old code for new admissions and preserves existing members. Renaming preserves membership IDs and code resolution. Existing buildings have registration disabled until an administrator sets a code.

The old sign-in enrollment, identity-code and invitation workflow is retired. ADMIN_INVITE_KEY is retained solely as the server-side gate for creating a new Administrator account; it is never required for sign-in or Viewer registration. Existing accounts, hashes, roles, memberships and building data remain intact. Roles are managed by authorised administrators; a registration code cannot promote a Viewer. No Building Join Code belongs in environment/public configuration or documentation.

After installing source changes, use `npm run stop` then `npm run dev`. Code changes through the setting take effect immediately. `npm run setup` preserves existing configuration. Configure ADMIN_INVITE_KEY privately on the server to enable new Administrator registration; blank disables that registration path while existing-user sign-in remains available. Read [INSTITUTIONS.md](INSTITUTIONS.md) for storage, limits and recovery. Verify with `npm test`, `npm run build`, `npm run test:auth-browser` and `npm run check:client-secrets`. Tests use isolated databases/profiles.

## Current status

The repository now contains a React/Vite frontend, Express API, MongoDB/Mongoose persistence, a separate durable worker, shared validated contracts, deterministic synthetic seed data and application tests. Reusable `.agents/skills/` tooling remains independent of the application.

Implemented workflows include session login and room-scoped roles, CSV preview/commit and manual meter entry, timetable editing/cancellation, interval/baseline analytics, anomaly investigation, recommendation decisions/outcome review, in-app notifications, persistent vacancy escalation, QR leases/extensions, staff overrides and guarded room-level simulation. Physical room hardware, general CCTV/RTSP inference, MQTT and SMTP remain unavailable integrations. The phone-demo pixel pipeline and optional dedicated meter OCR are implemented; physical commissioning is not claimed. Further acceptance coverage and installation work remain documented in TASKS.md.

## Intended prototype

- Import building meter readings through CSV/manual entry and room timetables through CSV/editing. Calculate compatible energy intervals, show data coverage and detect explainable anomalies.
- Recommend scheduling and efficiency changes with owners, evidence, estimated kWh/rupee benefits and outcome tracking.
- Use validated camera/presence observations where available; offer authenticated QR access leases where rooms have no occupancy source.
- Persist incidents and escalation: first alert after confirmed vacancy and protection checks, second alert 10 minutes later, final eligibility check after another 15 minutes.
- Default to alert-only room policies and simulated hardware. One independently controlled Wi-Fi smart master breaker per controlled room switches all its approved ordinary loads together.

Building meter readings do not establish unmetered room consumption. Camera observations, equipment estimates, simulated fixtures and measured data must retain distinct source labels. Unknown occupancy blocks vacancy-based automatic shutdown. QR expiry alone does not establish vacancy.

Physical installation is outside the hackathon deliverable. A qualified electrician must approve the feeder, downstream protection and every connected load before physical operation. Cameras, sensors, networking and essential supplies remain available when ordinary room supply is OFF. AC stop/restart requirements can block the entire room cutoff.

Separate institution workspaces, each containing one building, are supported. The scope excludes multi-building portfolios/comparisons, new per-appliance actuators, smart-plug purchases, per-button modules, AC IR blasters, facial recognition and attendance monitoring. The approved optional Home Assistant extension permits native OFF for reviewed existing smart appliances; room-master controls remain independent. Core functionality requires neither an LLM nor paid cloud services. See [scope and exclusions](PLAN.md#1-product-objective-and-agreed-decisions).

## Local setup and startup

The selected design uses React/Vite with JavaScript, Tailwind CSS, React Router, Recharts and Socket.IO; an Express/Node.js backend; MongoDB/Mongoose; and a separate persistent Node worker. Python is reserved for the optional FastAPI/OpenCV/person-detection/Tesseract vision and OCR service. See [the full stack and dependency choices](PLAN.md#9-recommended-software-stack).

Use Node 26.13.1 (recorded in `.node-version`) and npm. A workspace-local Node runtime is also pinned for npm scripts; the system Node used during development was older than the router's minimum. MongoDB is the real database, including during tests. The local development helper starts MongoDB 8.2.6 with persistent data under ignored `.local/` when the default local URI is not already reachable. Its first download is about 781 MB and needs network access. An existing MongoDB URI can be supplied instead; Docker is not required.

Run from the repository directory containing this README:

```bash
npm ci
npm run setup
npm run dev
```

Open `http://localhost:5173`. Setup creates ignored server configuration while preserving existing settings. New administrators register an institution/building name and start empty. Email/password login selects the existing membership automatically, or asks after authentication when several exist. Read [INSTITUTIONS.md](INSTITUTIONS.md) for migration, Building Join Codes, authorised membership choice and optional dedicated demo setup. Never commit `.env`.

Development starts the API at `http://localhost:5000`, worker and Vite. Startup never seeds samples. Existing installations require `npm run migrate:institutions` (dry-run), backup/stopped writers, then `npm run migrate:institutions -- --apply`. Explicit local demo: `npm run setup -- --enable-demo`, then `npm run seed`; dedicated credentials live only in ignored `.env`, existing identities/passwords/roles remain intact. Use `npm run stop` from another terminal for explicit owned-service cleanup, or Ctrl+C. A reachable existing local MongoDB is reused; an existing Campus Energy Vite server on port 5173 is also reused. Reused services are never stopped by the helper. Ignored `.local/dev-session.json` records process ownership; verify it rather than assuming all local listeners belong to this run.

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

The explicitly enabled dedicated demo seed supplies 30 calendar days of visibly synthetic intervals (only completed intervals on the current day), three rooms and test roles. Open a room to start normal-class, forgotten-lights, person-return or camera-offline fixture replay. Forgotten-lights demonstrates 15 seconds of vacancy confirmation, a first alert, escalation 10 seconds later and a final simulated recheck 15 seconds after that at the default 60× scale. In-app notifications are persisted; nobody is emailed. QR access uses its normal authenticated form; analytics and recommendation scenarios use seeded data. These are explicit fixtures, not genuine vision/OCR output.

Installation estimates require one suitable breaker quote per controlled room plus feeder/protection, labour, sensing, connectivity and commissioning costs. [Budget assumptions](PLAN.md#23-budget-purchasing-and-operating-cost-plan) are planning references, not current purchase quotes or verified payback. [Commercial options](PLAN.md#24-customer-segmentation-and-business-model) are future evaluation work; checkout, tenant management and ESG reporting are not MVP requirements.

Remaining work includes field vision coverage/OCR/model validation, actual device/notification transports, broader field/production acceptance, full account lifecycle, baseline history/version management, retention/migrations and deployment/commissioning. Manual reading correction, reset epochs and normal-stop confirmation are implemented with evidence/audit records. The engine rebuilds at most 20,000 readings and returns at most 1,500 chart intervals; it is a prototype, not a production utility ledger. Import commits are repeat-safe row operations, not transactions. Tariffs and seed equipment approvals are hypothetical and cannot authorise physical installation.

Live updates use the existing server connection across users/tabs. A status strip marks synchronising/disconnected/stale data; reconnect or foreground return refetches authorised backend state. For isolated multi-profile/two-tab verification, build then run `npm run test:realtime-browser` (installed Chrome/Edge). See API/ARCHITECTURE/TESTING for scopes and delivery limits.

Dedicated cumulative meter OCR now has its own Meter cameras admin panel,paired phone source and bounded local Tesseract worker. Run npm run setup:ocr explicitly; normal startup never installs it. Manual review is the default; accepted values reuse energy imports/intervals,not occupancy or control. Images are admin-only and retained latest12 pairs/camera for24h; original OCR/correction metadata persists. Physical verification remains unverified and accuracy is not guaranteed. See [METER_CAMERA.md](METER_CAMERA.md) for setup,provenance,capture loss/reset procedures and remaining physical checks.


## Consumption dashboard evidence

Overview and Energy use the existing Recharts charts and scoped live synchronisation. Actual interval energy is green at/below its own baseline and red above it, with linear segments split at the calculated crossing. Red alone is not an anomaly: configured tolerance thresholds and alert policy remain unchanged. Original readings use circle/diamond markers, flagged anomalies add a ring, and the labelled dashed baseline has square reference markers. Missing intervals, meter epochs and resolution changes break lines; gap aggregates remain isolated totals, never invented hourly points. Baselines disclose the configured hourly expectation or comparable-history median (hour/day type/schedule activity/duration).

Choose meter, data mode, 1/7/30-day lookback or custom date/time range. Lookbacks end at the latest accepted interval; custom inputs use the browser's local timezone and include whole intervals only. Card details use the latest original interval or the building-calendar daily rule. The chart/detail/export share the filtered records. Details include source-reading IDs, kWh, derived average kW, quality, baseline method/samples/version, tolerance and authorised related records; CSV downloads only this already-authorised snapshot. The energy feed returns at most 1,500 recent intervals, and related incident feeds remain bounded. Wider history and a new export permission model are not added.

The feed shows accepted-reading time, source and recorded interval length. Reading freshness is a disclosed heuristic (twice that interval), separate from workspace connectivity; physical source health/configured capture cadence are not asserted. Hourly energy is labelled hourly consumption; interval-derived kW is average power, never instantaneous power. No synthetic animation generates readings. Help icons explain baseline, power, savings, camera confidence, stale data, overrides and command verification: approximately 800ms hover, immediate keyboard focus/tap, Escape or outside-tap dismissal. A help Escape inside details leaves the dialog open; closing the dialog restores focus.

Verification command: `npm run test:consumption-browser` (build first). It uses an isolated temporary institution/database and headless Chrome, not existing accounts or meter records. See TESTING.md for checks and remaining field limits.

Authentication minimums: new passwords require **6 characters** and Building Join Codes **8 characters** (up to 64, including letters/numbers and six distinct characters). Sign-in accepts existing passwords unchanged. The Administrator registration key is required only for creating a new Administrator and must match server ADMIN_INVITE_KEY. Registration errors identify the invalid field. The anonymous /auth/session bootstrap does not require a signed-in account; protected /auth/me still returns 401 without one. Development StrictMode may repeat a cancelled startup request; the React DevTools message is informational. Browser-extension contentscript/ObjectMultiplex warnings are not emitted by this repository.

## Website assistant

Sign in, then use **Ask assistant** at the bottom right of the website. The existing `website-smart-bot` now runs inside the API at `/assistant`, with the same session and role/room permissions. No separate port or script snippet is needed. Install its locked dependencies once with `npm ci --prefix website-smart-bot`; normal `npm run dev` then serves it. The production API also mounts it after a normal frontend build.

Direct room/timetable/help answers work without Gemini. Optional Gemini configuration stays server-side in `website-smart-bot/.env` or deployment environment. Actual Gemini availability/model validity is not established by scripted tests. Embedded state is separated per immutable building under ignored `.local/assistant/`; the old standalone store is not automatically imported. Announcements remain inside the assistant. See [assistant guide](website-smart-bot/README.md).
