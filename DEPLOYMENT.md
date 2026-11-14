# Deployment preparation - CE-021

## Render + Vercel + Atlas (CE-024, current requested hosting)

Use [deployment/RENDER_VERCEL.md](deployment/RENDER_VERCEL.md) and root [render.yaml](render.yaml) for the requested separate Render API/worker, Atlas and three Vercel projects. Main-site HTTP proxy preserves Strict secure cookies across unrelated hosting domains; live updates connect directly with short-lived session tickets. Production ignores local `.env`, defaults bind to `0.0.0.0`, honours `PORT`, requires explicit MongoDB/infrastructure secrets and does not seed. Demo password variables are optional provisioning inputs, not login credentials. Existing accounts/hashes/memberships remain intact. The remaining Ubuntu/Caddy instructions below are an alternative deployment, not the Render configuration. No deployment has been performed.

Prepared for a single always-on **Ubuntu 24.04 LTS x86-64 Linux host with Docker Engine and Docker Compose**, fronted by Caddy. This is a prepared deployment, not a published service. No provider account, domain, server, tunnel, certificate or hardware has been provisioned. An Ubuntu VM from an existing approved provider or institution host can use these files. No static-only host can execute the backend, job worker, MongoDB, Python OCR/vision or assistant SQLite state.

Current official requirements checked 2026-11-14: [Docker Ubuntu prerequisites/install](https://docs.docker.com/engine/install/ubuntu/) includes Ubuntu24.04; published Docker ports can bypass ufw rules, so review host/provider filtering. [Compose startup ordering](https://docs.docker.com/compose/how-tos/startup-order/) distinguishes process start from health readiness. [Node releases](https://nodejs.org/en/about/previous-releases) lists Node26 LTS; the Dockerfile uses `node:26-bookworm-slim`. [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https) needs correct DNS, inbound80/443 and writable persistent certificate storage; [reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) handles WebSockets. Vite public-environment/build behaviour and Docker/Caddy syntax were also checked with Context7. Pin reviewed image digests before release; floating major tags are preparation defaults, not a reproducible container-image verification claim.

Also check [MongoDB production CPU/kernel requirements](https://www.mongodb.com/docs/manual/administration/production-notes/): x86-64 needs a supported microarchitecture and AVX exposed to the VM. The current notes flag kernel6.19 through7.0.13 as incompatible and state7.0.14 resolves that issue. Use a supported stock Ubuntu kernel and review the current notes before provisioning; a container still uses the host kernel. Durable volumes do not provide high availability or an off-host backup by themselves.

## Build and run each app

Install locked Node dependencies locally with `npm ci` and `npm ci --prefix website-smart-bot`. Never install/copy server credentials into browser assets. Build commands run from repository root:

| App | Independent production build | Output to host | Local development/start | Recommended deployed URL |
| --- | --- | --- | --- | --- |
| Main app, including direct authenticated presenter | `npm run build:main` | `frontend/dist/` | `npm run dev` | `https://energy.example.org/`; setup `/presenter` |
| Phone CCTV | `npm run build:phone-camera` | `dist/phone-camera/` | `npm run demo:camera` ->5174/cctv-camera/ | `https://energy.example.org/demo/cctv-camera/` |
| Virtual classroom/circuit | `npm run build:classroom` | `dist/virtual-classroom/` | `npm run demo:classroom` ->5175/circuit-board/ | `https://energy.example.org/demo/circuit-board/` |

`npm run build` builds the main app plus four independent demo artifacts and checks their assets; dedicated meter-phone and virtual-meter builds are retained. Phone artifacts contain their own `index.html`, `main.js`, `shared/` assets, local Socket.IO client and generated public `shared/config.js`. They work at an artifact root or mounted under the recommended path without fetching JavaScript from the backend or a CDN. Do not flatten/delete their `shared/` directory. No separate app server process is necessary for static phone artifacts. The Node API serves built main and demo artifacts; `npm start` starts it, and **a second terminal/process must run `npm run worker`**. Standalone dev previews proxy to the existing backend; they do not start another database or worker. Vite development/preview is not the production host.

Main SPA assets assume `/` as the application base. HTTP GET deep links such as `/energy`, `/profile` and `/presenter` must serve main `index.html`; missing `/assets/`, `/demo/` or `/api/` resources must return404 rather than the SPA. Express implements these rules. An independent static host must provide the same SPA rewrite and serve asset files with correct MIME types. Phone apps are single entry pages with relative assets; no SPA fallback is needed. Use trailing `/` on their deployment URLs.

The backend's production Content Security Policy explicitly permits its configured HTTPS/WSS endpoint and trusted main-app embedding origin. If the main bundle is hosted elsewhere, configure that static host's own policy to allow the intended API HTTPS and real-time WSS origin in `connect-src`, backend evidence origin in `img-src`, and backend assistant origin in `frame-src`; keep other directives restrictive. Do not solve a blocked socket/iframe by allowing all origins or exposing secrets. CORS and CSP are separate requirements.

## Public build addresses versus private server environment

| Variable | Where read | Example placeholder / behaviour |
| --- | --- | --- |
| `VITE_API_ORIGIN` | Main build environment / `frontend/.env.production` | blank = same page origin; or `https://api.example.org` |
| `VITE_REALTIME_ORIGIN` | Main build | blank defaults to API origin; exact HTTPS backend/socket origin |
| `PHONE_API_ORIGIN` | Independent phone build process | blank = phone page origin; or `https://api.example.org` |
| `PHONE_REALTIME_ORIGIN` | Phone build | defaults to phone API origin |
| `VITE_PHONE_API_ORIGIN`, `VITE_PHONE_REALTIME_ORIGIN` | Optional Vite source-only phone dev previews | public dev origin override; not server credentials |
| `FRONTEND_ORIGIN` | API and worker server environment | exact authorised main/presenter origin, e.g. `https://app.example.org` |
| `PUBLIC_APP_URL` | Server environment | external public backend/application origin, e.g. `https://api.example.org` |
| `DEMO_PHONE_ORIGINS` | Server | comma-separated exact camera/classroom origins; blank when same-origin |
| `DEMO_CAMERA_APP_URL`, `DEMO_CLASSROOM_APP_URL` | Server | optional complete trailing-slash app URLs, e.g. `https://camera.example.org/`; default backend `/demo/.../` paths |
| `HOST`, `PORT` | API | container `0.0.0.0`,5000; local default127.0.0.1 |
| `MONGODB_URI` | Server only | `mongodb://<operator>:<encoded-password>@<private-db>:27017/campus_energy?authSource=admin` |
| `SESSION_SECRET`, `SERVICE_INGEST_TOKEN` | Server secrets | two independent high-entropy values of at least32 characters; preserve stable session secret |
| `ADMIN_INVITE_KEY` | Server secret | private Administrator registration key; sign-in never needs it |
| `DEMO_MODE`, `DEMO_TIME_SCALE` | Server | normal product `false`,`1`; separate judge environment `true`,`1`; presenter uses separately stored demo timing |
| `ALLOW_PHYSICAL_CONTROL`, `ALLOW_NATIVE_DEVICE_CONTROL` | Server | keep both `false` |
| `OCR_PYTHON`, `DEMO_VISION_PYTHON` | Server | container `/opt/vision/bin/python`; local absolute executable path as required |
| `GEMINI_API_KEY`, optional `GEMINI_MODEL` | Server only | optional provider key and separately verified available model; never browser configuration |

Root `.env` is server configuration, not the main Vite environment file. Only explicitly public origin names reach clients. Blank public origins mean same-origin, not localhost. Explicit production origins reject HTTP, localhost/loopback, paths, credentials and wildcards. Browser-visible host changes require rebuilding the relevant frontend and updating server allowlists; restarting a static file server alone cannot rewrite a built bundle. The Docker build supports matching public `ARG` names for deliberately different frontends; the supplied Compose build uses blank same-origin settings.

For example, in a **Linux build shell** (public values only):

```sh
VITE_API_ORIGIN=https://api.example.org VITE_REALTIME_ORIGIN=https://api.example.org npm run build:main
PHONE_API_ORIGIN=https://api.example.org PHONE_REALTIME_ORIGIN=https://api.example.org npm run build:phone-camera
PHONE_API_ORIGIN=https://api.example.org PHONE_REALTIME_ORIGIN=https://api.example.org npm run build:classroom
```

Main authentication uses `credentials:include`, HttpOnly/Secure/SameSite=Strict cookies and existing CSRF tokens. Supported separate origins must be **same-site HTTPS sibling domains** owned by the deployment, such as app.example.org/api.example.org; unrelated third-party hostnames can block Strict cookies and are not claimed supported. Same-origin Caddy routing is the recommended topology and avoids that dependency. The backend permits credentialed CORS only for exact main/public origins; phone origins get bearer-capability access only to phone routes, never general app CORS. Socket handshakes use the same exact allowlists plus session/membership or scoped phone-token checks. A phone URL never authenticates a user or grants a role. Pairing URLs must use allowlisted origins; institution-qualified, one-use expiring codes remain in fragments. Do not put credentials or long-lived tokens in public URLs. Across separate main/API origins, retained meter/frame images and assistant iframe use the configured backend origin and existing authorisation; embed ancestry is limited to the main/public app origins.

## Prepare the Linux host and deploy in order

1. Obtain an approved always-on Linux host, DNS name and administrative access. Select adequate memory/CPU/storage after measuring OCR/frame workload; this task supplies no performance benchmark or guaranteed VM sizing. Install Docker Engine/Compose using the official Ubuntu instructions above. Confirm `docker info` and `docker compose version`. Review the pinned Node/Python/native wheels and image manifests for the chosen architecture. The prepared image installs Python3, OpenCV/NumPy/Pillow, tesserocr and checksum-pinned English OCR data during image build, not on ordinary startup. Image build needs npm, Python packages and official model-download connectivity.
2. Transfer the reviewed source to the host without `.env`, `.local`, Git history or local database files. Keep a separately protected backup of real configuration. `.dockerignore` excludes all environment files, local state and credentials from image context. No push or publication is required by these instructions. Place source at an operator-controlled directory and restrict the private deployment configuration to its operator.
3. Copy `deployment/.env.example` to **ignored** `deployment/.env`. Replace `APP_HOST` with your actual DNS hostname, and supply independent generated MongoDB/session/ingestion/Administrator-registration secrets. Use a URL-safe MongoDB password or percent-encode URI reserved characters. Example files contain placeholders and cannot run the application successfully unchanged. Keep `DEMO_MODE=false`, `DEMO_TIME_SCALE=1` and both physical gates false for normal product operation. Do not run `npm run seed` against an institution to populate a demo.
4. Point DNS to the actual host and allow inbound TCP80/443 (optional UDP443 for HTTP/3). API5000/MongoDB27017 are **not** host-published; only Caddy is exposed. Review provider firewall and Docker forwarding rules rather than assuming ufw alone covers published ports. Keep private device gateways on a reachable trusted network; cloud hosting does not make private CCTV/NVR/HA addresses reachable.
5. From repository root on the Linux host, validate and build without printing resolved secrets:

   ```sh
   chmod 600 deployment/.env
   docker compose --env-file deployment/.env -f deployment/compose.yaml config --quiet
   docker compose --env-file deployment/.env -f deployment/compose.yaml build
   docker compose --env-file deployment/.env -f deployment/compose.yaml up -d mongo
   ```

6. For an **existing database**, back it up and follow migration review below before API/worker startup. A new empty database requires no legacy migration and is never automatically seeded. Then start services:

   ```sh
   docker compose --env-file deployment/.env -f deployment/compose.yaml up -d api worker
   docker compose --env-file deployment/.env -f deployment/compose.yaml logs --tail 30 api worker
   docker compose --env-file deployment/.env -f deployment/compose.yaml up -d caddy
   ```

   Caddy proxies API/SPA/assistant/phone assets and Socket.IO upgrades without path stripping. API trusts exactly one proxy hop; do not expose its port directly or chain extra unreviewed proxies. Caddy data/config, MongoDB and assistant SQLite are persisted in named volumes. API readiness checks database connectivity; it does not prove the worker is processing jobs or vision is healthy. Confirm worker logs and a scoped simulated job separately. Use one API and one persistent worker; multi-API assistant SQLite coordination/sticky-session scaling is outside this preparation.
7. Check the actual HTTPS app and `/api/v1/health`, `/api/v1/ready`, anonymous protected-route401, secure session cookie, registration/login and WebSocket reconnect in your deployment. Register the first Administrator using the private server key and chosen Building Join Code; its institution starts empty. Configure rooms/inventory/meter sources through normal Management. Test your own backup/restore before relying on durability. No registration secret is embedded in frontend files.

The current prepared MongoDB credential is a private operator/bootstrap account able to create the application's per-institution databases. It is not a public API credential. Before a real installation, review least-privilege database provisioning and secret management for that deployment; do not publish MongoDB or share operator credentials with clients. Session and institution databases are all required for a coherent restore.

## Backup and legacy migration

Use protected off-host encrypted backups and a documented retention/restore schedule. Never run `docker compose down -v` on an installation to update the code; that destroys persistent volumes. Do not change `SESSION_SECRET` casually: it also keys Building Join Code lookup verifiers; follow INSTITUTIONS.md if replacing it. Keep server configuration recoverable separately from data.

For a coherent standalone-Mongo backup, first stop API/worker writers (also stop Caddy to avoid apparent availability), keep MongoDB running, and back up **all databases**, including global directory, per-institution operational databases, sessions, jobs and audit. These Linux commands are operator instructions, not actions executed in this task:

```sh
umask 077
mkdir -p secure-backups
docker compose --env-file deployment/.env -f deployment/compose.yaml stop caddy api worker
docker compose --env-file deployment/.env -f deployment/compose.yaml exec -T mongo sh -c 'mongodump --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip' > secure-backups/mongo.archive.gz
docker compose --env-file deployment/.env -f deployment/compose.yaml run --rm --no-deps --entrypoint tar api -czf - -C /app/.local/assistant . > secure-backups/assistant.tar.gz
```

Check command success, nonempty files and checksums; secure these files because they contain personal records, password hashes, sessions and assistant audit/proposal history. Back up Caddy configuration/certificate volume through the host's protected volume-backup process. Do not copy an active MongoDB data directory or active SQLite file as if it were a consistent logical backup.

Restore rehearsal must use an **isolated** project/volumes, not the running installation. The following fixed project name creates a separate private Mongo service; confirm its project/volume names before the destructive restore step. `--drop` is only appropriate for this isolated restore target. Its bootstrap Mongo admin is retained by excluding `admin.*`. Restore assistant state with its API stopped:

```sh
docker compose -p campus-energy-restore --env-file deployment/.env -f deployment/compose.yaml up -d mongo
docker volume ls --filter label=com.docker.compose.project=campus-energy-restore
# Confirm the isolated restore target above before running --drop:
docker compose -p campus-energy-restore --env-file deployment/.env -f deployment/compose.yaml exec -T mongo sh -c 'mongorestore --username "$MONGO_INITDB_ROOT_USERNAME" --password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin --archive --gzip --drop --nsExclude="admin.*"' < secure-backups/mongo.archive.gz
docker compose -p campus-energy-restore --env-file deployment/.env -f deployment/compose.yaml run --rm --no-deps --entrypoint tar api -xzf - -C /app/.local/assistant < secure-backups/assistant.tar.gz
```

Do not start the restore project's public Caddy listener or its worker while checking restored data. Verify institution IDs, memberships, roles, joins, readings, reports and jobs before restarting writers; rotated/expired command leases must be rechecked, never replayed blindly. These instructions were prepared, not executed against a Docker host.

With API/worker still stopped, review an existing unscoped legacy installation using the supplied image and actual configuration:

```sh
docker compose --env-file deployment/.env -f deployment/compose.yaml run --rm --no-deps --entrypoint node api scripts/migrate-institutions.mjs
# Only after reviewing the dry-run, resolving ownership conflicts and verifying backup:
docker compose --env-file deployment/.env -f deployment/compose.yaml run --rm --no-deps --entrypoint node api scripts/migrate-institutions.mjs --apply
```

Do not automatically apply migration on container boot. Preserve old IDs/hashes/memberships, original database and historical audit; ambiguous ownership remains blocked. Current scoped databases need additive indexes/collections only. `createInstitutionApplication` initialises them at startup. The code does not delete/move an existing user's building membership. Restart `api worker caddy` only after the reviewed result and scope checks pass. Keep backups and a known previous image; rollback code without restoring/moving people between buildings.

## Separate judge environment and physical rehearsal

For the phone demonstration, use a separately configured host/project/database with `DEMO_MODE=true`, `DEMO_TIME_SCALE=1` and both physical gates false. All readings submitted to a demo backend are forcibly simulated. Do not turn an operational institution into a sample database. Build all three frontends for that judge backend or keep their origins blank behind its own Caddy origin. A separate Compose project (`-p campus-energy-demo`) with its own private environment, hostname and volumes is the isolation boundary. Use `SERVER_ENV_FILE=.env.demo` with `--env-file deployment/.env.demo` for that project's private file. Do not change the normal product environment to accelerate jobs.

You may register an empty dedicated demonstration institution and configure its rooms normally. Optional fixtures require explicit unused `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `DEMO_VIEWER_EMAIL`, `DEMO_VIEWER_PASSWORD` in the **private** judge server file (passwords at least20 characters). For that judge project only, the one-off seed command is `docker compose -p campus-energy-demo --env-file deployment/.env.demo -f deployment/compose.yaml run --rm --no-deps -e ENABLE_DEMO_SETUP=true -e ALLOW_PRODUCTION_DEMO_SEED=true --entrypoint node api scripts/seed-demo-workspace.mjs` with `SERVER_ENV_FILE=.env.demo`. It creates/reuses the isolated dedicated sample workspace, never repurposes existing accounts or normal institutions. Do not copy credentials to a phone or shell command. Ordinary startup seeding remains disabled.

Direct presenter URL: **`https://<judge-host>/presenter`**. Camera: `/demo/cctv-camera/`; classroom: `/demo/circuit-board/`. Main product navigation has no demonstration entry. `/phone-demo` is a compatibility-only direct presenter alias. Follow [DEMO_SETUP.md](DEMO_SETUP.md) for pairing, coverage, timing, truthful judge script and physical-phone checklist. The laptop loopback internal HTTP connection used by the embedded assistant or container health probe is server-local, never a phone's production backend address.

CE-023 quick UI: **Prepare a room for simulation** consolidates explicit room/load review on a simulation-only server, followed by session creation and **Prepare both phone links**. It refuses quick preparation if the server reports live mode/control and rechecks health before writes. Existing role/room APIs still authorise every change. A paired-app link now consumes its one-use fragment automatically; the browser removes that fragment and still requires explicit camera Start/permission. Active sessions reopen without reselecting. No deployment origin/HTTP/socket/pairing contracts changed; rebuild/reload the static phone artifacts to receive the new UI. Protected loads,live evidence separation and command acknowledgements remain unchanged.

## Verification status and limits

Executed current commands/results are recorded in HANDOFF.md and TESTING.md. Compose configuration can be validated without an engine, but this workstation's Docker engine is unavailable: no container image build, container Python wheel compatibility, real host startup, DNS, TLS issuance, external WebSocket proxy or backup/restore rehearsal is claimed. Browser verification uses temporary databases and isolated profiles; the camera MediaStream is synthetic rendered pixels. Real phone filming, mobile permissions/backgrounding, physical Wi-Fi/certificates, meter calibration, licensed live footage, controller/electrical commissioning and real switching still need the checks in DEMO_SETUP/METER_CAMERA/HOME_ASSISTANT. Live Gemini/model/quota needs optional provider credentials and separate validation. No physical-control adapter is commissioned; the software refuses its enablement.
