# Render + Vercel + Atlas preparation (CE-024)

These are operator instructions, not evidence of a deployed service. All domains below are placeholders. No deployment, push, account reset or real-database migration was performed.

## Authentication and configuration

Sign-in always compares the submitted password with the persisted bcrypt hash. Normal registration remains minimum **6 characters**; existing six/eight-character passwords continue working. Roles and building memberships come from the database. `ADMIN_INVITE_KEY` authorises only new administrator registration; it does not replace an account password or belong on the sign-in form. New administrators create empty buildings. Viewers register through the Building Join Code and receive only Viewer membership.

`DEMO_ADMIN_PASSWORD` and `DEMO_VIEWER_PASSWORD` are **one-off seed inputs**, not login overrides. Previously their 20-character validation ran during every startup, incorrectly blocking existing ordinary accounts. They now validate only when explicitly running the seed. Development/test provisioning accepts 6-100 characters; **production provisioning still requires 20-100**, even with demo mode enabled. Missing or unused short demo values no longer block normal startup. A seed retry preserves existing passwords, roles and IDs; changing these environment values does not reset an existing password. Distinct unused valid emails are required for initial provisioning.

Production reads the service environment, ignoring local `.env` files (including assistant `.env`). A local `.env` stays private and unchanged. Configure API and worker consistently:

| Category | Variables and requirements |
| --- | --- |
| Required production infrastructure | `NODE_ENV=production`; `MONGODB_URI=mongodb+srv://<db-user>:<encoded-password>@<atlas-host>/<directory-db>`; independent stable `SESSION_SECRET=<random-32-plus-characters>` and `SERVICE_INGEST_TOKEN=<different-random-32-plus-characters>`; `FRONTEND_ORIGIN=https://<main>.vercel.app`; `PUBLIC_APP_URL=https://<api>.onrender.com` |
| Binding | `HOST=0.0.0.0` (production default); Render supplies `PORT`, which the server honours; container fallback 5000 |
| Registration | `ADMIN_INVITE_KEY=<private-key-at-least-8-characters>` required to create administrators, optional for startup/existing sign-in |
| Safe judge demonstration | `DEMO_MODE=true`, `ALLOW_PHYSICAL_CONTROL=false`, `ALLOW_NATIVE_DEVICE_CONTROL=false`, `DEVICE_ADAPTER=simulator`, `NOTIFICATIONS_MODE=in_app`, `DEMO_TIME_SCALE=60` |
| Separate phone apps | `DEMO_PHONE_ORIGINS=https://<camera>.vercel.app,https://<classroom>.vercel.app`; `DEMO_CAMERA_APP_URL=https://<camera>.vercel.app/`; `DEMO_CLASSROOM_APP_URL=https://<classroom>.vercel.app/` |
| Explicit seed only | Normally `ENABLE_DEMO_SETUP=false`, `ALLOW_PRODUCTION_DEMO_SEED=false`; emails/passwords may be absent. Set both gates true only for an intentional production seed in simulated mode, then disable/remove provisioning inputs. Ordinary start/worker never seed. |
| Optional integrations | `GEMINI_API_KEY` enables assistant provider calls; absent key keeps fallback behaviour. SMTP is not required (`in_app` only). OCR/vision paths point to installed runtimes; unavailable inference cannot establish vacancy or accept a meter reading. Home Assistant remains disabled in this demonstration. |
| Durable assistant state | `ASSISTANT_DATA_DIR=/app/.local/assistant` on the API's persistent disk; SQLite stores isolated assistant history/proposals, while core accounts, sessions, readings, reports and jobs live in Atlas |
| Development only | `npm run setup`, local MongoDB launcher, loopback origins, Vite dev server and optional six-character development seed; do not copy local configuration wholesale into Render |

Generate each infrastructure secret privately, for example `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` on your machine. Store its output directly in the server secret settings; never paste it into source, build variables, screenshots or logs. Keep the same session secret on API/worker and across redeploys: it also keys Building Join Code lookup verifiers. Rotating it invalidates sessions and requires replacing join codes. Configuration errors name invalid fields and requirements without printing values.

## Deployment order

1. Back up the current MongoDB directory **and every institution database**, plus assistant state. Prepare Atlas database-user credentials and network access for the chosen Render region/service. Use least privilege covering the directory and institution database prefix; one directory database alone is insufficient because workspaces use separate databases. Do not use an unrestricted network allowlist as a default.
2. Preserve the current DB data when moving to Atlas. A fresh Atlas database will not contain local accounts. Restore the backed-up directory and all institution databases together, keeping database names, user IDs, memberships and hashes. Verify a restore on an isolated target before directing production traffic to it. No password or schema migration is required by CE-024. For an older single-installation DB, first run `npm run migrate:institutions` in the controlled server environment for a dry run; only after backup and reviewing the ownership report run `npm run migrate:institutions -- --apply`. Never apply this routinely at startup.
3. Prepare the Render API and continuously running worker from repository root using `render.yaml`. The `campus-runtime` group contains safe constants only. Supply the API service-level prompted Atlas URI, exact frontend origins and stable secrets; the worker references those API values. Render ignores `sync:false` inside environment groups, so secrets are deliberately outside that group. On later Blueprint updates, add new secret settings manually; prompts occur only at initial creation. Use `deployment/Dockerfile` / root Docker context. It installs the Python/OpenCV/OCR runtime, assistant dependencies and four demo assets. Render passes `BUILD_MAIN=false` to the Docker build, skipping the unnecessary main SPA while retaining all demo/API/assistant routes. Standalone Docker/Caddy defaults to `BUILD_MAIN=true`. The build stage uses `npm ci --include=dev`; start is `npm start`, worker start is `npm run worker`. The API health path is `/api/v1/ready`. There is no seed or migration in either start command.
4. The supplied Blueprint selects paid Starter services and a persistent API disk; review pricing yourself. A sleeping/free API is unsuitable for a timed demonstration, and the policy worker must run continuously. Check disk write access for the image's `node` user and assistant persistence after redeploy. Atlas supplies durable core data. Back up the assistant disk separately; a disk is not a backup. Docker image build/deployment and mounted-volume ownership still need verification on the host.
5. Once the actual API URL is known, run locally `npm run configure:vercel -- https://<api>.onrender.com`. This writes three **public, ignored** files under `deployment/generated/`; it does not deploy. Regenerate when the API origin changes. Create three Vercel projects, all with repository root as project root, using the appropriate generated configuration. Set each project's build variables below before building. Do not set production secrets on Vercel.
6. Use Vercel's CLI `--local-config deployment/generated/vercel-main.json` (or camera/classroom equivalent) when performing an authorised deployment, or put that project's generated JSON at root `vercel.json` in its deployment checkout before the Git integration builds. The generator itself does not modify source routing or execute the CLI. All use `npm ci --include=dev`; commands/output are listed below. Keep actual camera/classroom project URLs in the API and worker's exact allowlist and pairing URL settings. Refresh/rebuild after public-origin changes.
7. Check readiness, account login, refresh, logout, both roles, scoped live updates, assistant access and phone pairing over real HTTPS. Check worker logs/heartbeats, room protections and acknowledgement delivery. Reserve real-phone QR/camera rehearsal for the deployed URLs; `localhost` on a phone points at that phone.

| Vercel project | Build command | Output | Public build environment |
| --- | --- | --- | --- |
| Main | `npm run build:main` | `frontend/dist` | `VITE_API_ORIGIN=` (empty/unset); `VITE_REALTIME_ORIGIN=https://<api>.onrender.com` |
| Camera | `npm run build:phone-camera` | `dist/phone-camera` | `PHONE_API_ORIGIN=https://<api>.onrender.com`; `PHONE_REALTIME_ORIGIN=https://<api>.onrender.com` |
| Classroom | `npm run build:classroom` | `dist/virtual-classroom` | same two `PHONE_` origins |

For a **native Node Render** alternative, build from root with `npm ci --include=dev && npm ci --prefix website-smart-bot && npm run build:demo`; start `npm start` and create a separate worker using `npm run worker`. Set a compatible Node version (repository engines require >=22.22). This command alone does **not** install Python/OpenCV/Tesseract assets: provision those runtime dependencies and paths separately before claiming camera inference or meter OCR works. The supplied Docker path includes them and avoids that native-runtime assumption. Do not use a static host for the API, worker or vision runtime.

## Cookies, HTTP proxy and live updates

Unrelated `vercel.app` and `onrender.com` domains can trigger third-party cookie blocking. The main generated Vercel configuration proxies `/api/*` and `/assistant/*` to Render while keeping the browser URL on the main site. Cookies remain `HttpOnly`, `Secure` in production and `SameSite=Strict`, with no Domain override. Express trusts the hosting proxy; CSRF tokens and exact Origin checks remain enforced. The SPA fallback excludes API, assistant and asset paths; normal static files are served as files. This routing must be installed before testing sign-in. Direct cross-site API access is not the recommended cookie architecture.

Live Socket.IO traffic connects **directly to Render**; this project does not implement a Vercel WebSocket server or tunnel it through the HTTP rewrite. Before each connection/reconnect, the frontend obtains `/api/v1/sync/ticket` through its authenticated HTTP proxy. The signed 60-second ticket identifies a persisted session, carries no roles/passwords, stays in memory and is transmitted in the Socket.IO auth payload rather than a URL. The backend verifies the signature, reloads the stored session and resolves current membership. It continues checking session/account/role/permissions while connected. Logout, disabled membership or workspace change revokes access. Same-origin local deployments retain existing cookie-based sockets. Phone apps retain their independent, institution/session/role-scoped bearer pairing; they receive no administrator session cookie.

API and embedded assistant responses set `Cache-Control: no-store`; preserve it if adding a CDN/cache layer; never cache private API/assistant responses or strip `Set-Cookie`. Custom CSP must allow the exact backend HTTPS/WSS origin in `connect-src`, appropriate evidence images, and assistant frames; do not add wildcard origins. Preview frontend URLs need explicit authorisation or a separate isolated backend, not wildcard CORS. Static camera/classroom assets use relative paths and a trailing `/` entry URL.

## Persistent demonstration accounts

**Existing accounts:** transfer/retain their database and sign in normally. Remove unused demo password variables if desired; never change persisted hashes to match environment values. Reuse the original member's building. Normal startup does not create duplicates, rooms or sample readings.

**Ordinary-account option:** register an administrator through the main UI with the private administrator registration key and a chosen Building Join Code; then register a Viewer using that code. Both use the existing six-character minimum. The new building starts empty; configure only reviewed simulated room/load inventory. This workflow needs no demo-password variables, seed gates or special login bypass.

**Isolated fixture option:** in a controlled local development/test environment, explicitly enable `ENABLE_DEMO_SETUP=true` and `DEMO_MODE=true`, configure distinct unused demo emails/passwords (6+), and run `npm run seed`. Production fixture provisioning additionally requires `ALLOW_PRODUCTION_DEMO_SEED=true` and 20+ character passwords. Production demo mode never weakens this rule. Disable the gates afterwards. To use existing six/eight-character accounts in production, preserve/restore those ordinary persisted accounts; do not rerun a weak production seed. The seed refuses conflicts and preserves existing passwords/memberships, including on repeat runs with different valid provisioning inputs. No credential retrieval endpoint is provided.

## Rehearsal and known verification limits

Open `https://<main>.vercel.app/presenter`, sign in with an existing administrator, review the selected **simulated** room and ordinary load inventory, create/resume a session and prepare the two role-specific phone links. Open camera link on Phone A, explicitly grant permission/start capture; open classroom link on Phone B, select/lock the scene and keep the whole QR marker visible. Verify fresh observations, then first alert, escalation, final recheck and **acknowledged simulated OFF**. Positive occupancy/protected use must cancel it. Disconnect a camera/device and check unknown/stale/unverified state. Scene-injection mode is a separate synthetic check and is not pixel-processing evidence. See [DEMO_SETUP.md](../DEMO_SETUP.md) for timing and safety details.

Current local tests exercise persisted MongoDB accounts and an isolated HTTP proxy plus different-site cookie-free sockets. They do not prove Atlas network credentials, real Render/Vercel proxy header behaviour, TLS/certificates, Render disk permissions, Docker image build, real-phone filming or physical switching. Run that final hosted rehearsal yourself after an authorised deployment. Nothing here changes room safety policy or permits live equipment control.

Current official references checked via Context7 on 2026-11-14: [Render Docker build arguments](https://render.com/docs/docker), [Render port binding](https://render.com/docs/web-services), [Blueprint environment groups/services/disks](https://render.com/docs/blueprint-spec), [Vercel external rewrites](https://vercel.com/docs/rewrites), [Vercel local configuration option](https://vercel.com/docs/cli/global-options). The unrelated existing Ubuntu/Docker/Caddy deployment remains supported in [DEPLOYMENT.md](../DEPLOYMENT.md).

## Exact CE-024 file manifest

- `.env.example`
- `.gitignore`
- `API.md`
- `CHANGELOG.md`
- `DATABASE.md`
- `DEMO_SETUP.md`
- `DEPLOYMENT.md`
- `HANDOFF.md`
- `INSTITUTIONS.md`
- `PROGRESS.md`
- `README.md`
- `TASKS.md`
- `TESTING.md`
- `backend/src/app.js`
- `backend/src/config.js`
- `backend/src/realtime/transport.js`
- `backend/src/seed.js`
- `backend/src/services/website-assistant.js`
- `backend/src/workspaces/demo-seed.js`
- `deployment/Dockerfile`
- `frontend/src/services/live-sync.js`
- `package.json`
- `scripts/cross-origin-browser.mjs`
- `tests/final-integration.test.js`
- `website-smart-bot/README.md`
- `backend/src/realtime/tickets.js`
- `deployment/RENDER_VERCEL.md`
- `render.yaml`
- `scripts/configure-vercel.mjs`
- `tests/deployment-auth.test.js`

Generated deployment/generated/vercel-{main,camera,classroom}.json files are ignored local output. The actual .env,lockfiles,PLAN and persisted user databases were not changed. Verification evidence and known limits are in [TESTING.md](../TESTING.md) and [HANDOFF.md](../HANDOFF.md).
