# Website assistant

A role-aware chat assistant for the Campus Energy website, powered by Gemini only where it is needed.

The main website now embeds this assistant at /assistant and shows an Ask assistant button to signed-in users. It can also run as a separate service. It reads and changes data **only through the website's own HTTP API, as the person who is signed in**, so the website keeps enforcing roles, room scope, validation, CSRF and its own audit trail.

## How this maps onto this website

The brief this was built from described floors, rooms, animals, feeding schedules and announcements. This website is a campus energy system, so the same ideas map like this:

| In the brief | On this website |
| --- | --- |
| Floors and rooms | Floors and rooms (the website's `/management/floors` and `/spaces` services) |
| Animals in a room | Equipment recorded in a room (lights, fans, sockets, AC) |
| Feeding schedule | Timetable bookings for a room |
| Announcements and alerts | Announcements published through the assistant (see limitations) |
| Admin and viewer | Administrator mode and read-only mode (HOD, technician, teacher and viewer accounts all get read-only mode with their own room scope) |

## Quick start

The website must be running (backend on port 5000).

```bash
cd website-smart-bot
npm install                 # if registry.npmjs.org is blocked on your network: npm install --registry https://registry.yarnpkg.com
cp .env.example .env        # then set GEMINI_API_KEY
npm run check:model         # confirms GEMINI_MODEL exists for your key (does not use a chat request)
npm start                   # http://localhost:5190/chat
```

Sign in to the website first. The chat page and the website must share a site (same host, any port in development; same registrable domain over HTTPS in production) so the website's session cookie reaches the assistant.

### Built-in website integration

The main React app automatically renders **Ask assistant** after sign-in. The panel is served under the website's same origin at `/assistant/chat`, using the existing API session and role permissions; no external script, iframe hostname or separate port is required. Anonymous users see no button and cannot fetch the embedded endpoints. Close via either close button or Escape; the mobile panel stays inside the viewport.

Install this folder's locked dependencies once with `npm ci --prefix website-smart-bot` from the repository root, then start the website normally with `npm run dev` (or build/start). No separate assistant service is needed. Optional Gemini settings are read server-side from this folder's ignored `.env` or deployment environment; direct website answers work without an API key. Neither environment file was modified by the integration.

Embedded instances use separate `.local/assistant/<immutable-building-id>.sqlite` stores, caches and proposal state. Browser history identities include building and user. Building changes recreate the panel, and every request revalidates membership; logout revokes access. Announcements remain assistant-only. Gemini budgets are per embedded building; an API key shared across buildings still needs deployment-wide quota planning. The standalone `.data` store is retained independently and is not silently migrated into building stores. In embedded mode the short website-data read cache is disabled, so each new query rereads authorised API snapshots; reply caching still uses the exact snapshot digest. Public frontend/API origins and same-site HTTPS deployment are documented in ../DEPLOYMENT.md; backend credentials remain server-only.

The existing widget.js snippet is only for separately hosted standalone use; it is not loaded by the integrated app. Its deployment/CSP requirements below apply to that mode.

## What it can do

**Everyone (read-only, own scope only)**: rooms they can access, where a room is, today's or tomorrow's timetable, equipment recorded in their rooms, announcements aimed at them. Anything outside their scope is reported as not found; floors are an administrator-only fact on this website, so viewers are told that.

**Administrators**: everything above plus the whole building, and these changes. Each is previewed first and applied only after the administrator confirms:

| Say something like | What happens |
| --- | --- |
| "Create a floor named B1 with 4 rooms" | Creates floor B1 and rooms B1-001 to B1-004 using the website's own naming (`Classroom 001`). A basement code like B1 gets order -1. |
| "Add 3 rooms to floor B1" | Adds rooms continuing the numbering. |
| "Add 3 fans of 75 W to room R102" | Records equipment. A missing wattage is asked for, never guessed. Items are recorded as **not approved for shared supply cutoff**; the assistant never sets electrical approvals. |
| "Send an alert to all viewers that feeding starts at 10 AM tomorrow" | Publishes an announcement to viewers, staff or everyone, and shows real delivery status. |
| "Book R101 tomorrow at 10 for the BCA lecture" / "Cancel the BCA lecture in R101 tomorrow" | Creates or cancels a booking (interpreted by Gemini, then validated). |

It cannot edit or delete existing records, change room-master or safety settings, or switch any supply.

## How Gemini use is kept to a minimum

Quota assumed: **5 requests per minute, 20 per day** (configurable; match your dashboard).

1. **Most messages never reach Gemini.** A deterministic router answers counts, lists, room lookups, timetable, equipment, announcements, help, confirm/cancel and clearly structured admin commands straight from the website's API. Follow-ups ("what about R102?", "and tomorrow?") and missing-detail questions ("what wattage?") are also handled without a model.
2. **Gemini handles only open-ended questions** ("which of my rooms is best for 30 people?") and ambiguous admin requests (a booking in natural language). One request per message, never a tool-call loop: the relevant data is sent once in a compact, size-limited snapshot, and the model answers or proposes a change in a single response.
3. **Central budget** (`src/quota.js`, counted in SQLite so a restart cannot reset it): per-minute and per-day limits, a daily reserve so administrators can still act after viewers have used their share, a per-person daily share, a minimum gap between a person's AI requests, and priority admin action > admin question > viewer.
4. **Caching and deduplication.** Identical open questions share one in-flight request; answers are cached by role, question, conversation context and a digest of the exact data used, so a changed website record can never be answered from a stale cache. The assistant's short read cache is cleared after every change it makes.
5. **429 handling.** One retry only, and only if Gemini asked for a short wait and the budget still has room. A long wait is reported, and all requests pause until it passes.
6. **Graceful fallback.** When the allowance is spent, Gemini is down, the key is missing or the model is wrong, the person gets the reason, when to retry, and the questions that still work directly. Database-backed features never depend on Gemini.

Counted conservatively: every attempt that leaves the server uses one unit of budget, including a retry.

## Security

- All Gemini calls are server-side. The API key never reaches the browser; tests fetch every page and endpoint to prove it.
- Sign-in is the website's own session. Every request is resolved against the website; signing out there, or being deactivated, ends access at once.
- Writes need the assistant's own origin plus the website's per-session CSRF token. The page can be embedded only by the website (`frame-ancestors`), runs no inline script, and inserts all text with `textContent`.
- **Gemini only proposes.** A model never executes anything. Proposals are validated against strict schemas, previewed with live data, re-checked right before running, and applied only after an explicit confirmation by the administrator who created them. Viewers are never given any tool; a tool call from a model on a viewer's behalf is dropped and audited.
- Prompt injection: website text is shortened, flattened, stripped of markup and fence look-alikes, and sent between a random per-request fence labelled as data. Model output is shown as plain text, with markup and invented links removed.
- Idempotent: a confirmed change runs once however many times it is confirmed or delivered; a repeated message id returns the first answer.
- Audit: the website records each change against the real administrator (`floor.create`, `space.generate`, and so on); the assistant also keeps its own log (`GET /api/audit`, administrators only).

## Transactions, honestly

The website has no delete endpoint for floors, rooms or equipment, so a multi-step change cannot be rolled back after a step succeeds. Instead the assistant re-checks the plan immediately before acting, saves progress after every step, reports exactly what was and was not done if a step fails, and lets the administrator confirm again to **resume from the failed step without repeating completed work**. Publishing an announcement is a single SQLite transaction and does roll back.

## Environment variables

See `.env.example` for every setting with its default. The ones you must consider: `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_RPM` / `GEMINI_RPD` (your dashboard limits), `APP_API_URL`, `APP_ORIGIN` (an origin the website already trusts for writes), `APP_PUBLIC_URL`, `ASSISTANT_PUBLIC_URL`.

## Tests

```bash
npm test          # 59 tests: 14 pure, 45 against the real website backend with a scripted Gemini
npm run check:ui  # 28 checks in headless Chrome (needs Chrome or Edge installed)
```

The integration tests import the website's backend read-only and start it on a throwaway in-memory MongoDB, then drive the assistant over HTTP. Gemini is always scripted, so no real quota is spent. They use the `mongod` binary already present under the repository's `node_modules/.cache` (override with `MONGOMS_SYSTEM_BINARY`). The standalone harness uses temporary databases; integrated website tests keep assistant stores in memory.

## Limitations

- **The real Gemini SDK call is not exercised by the tests**, only by the scripted stand-in behind the same interface. It was written against the installed SDK's type definitions, but the first real request is the first real check. Run `npm run check:model` first.
- **`gemini-3.8-flash` is the configured default as requested but is unverified**: there was no API key here to confirm it exists. If it does not, `check:model` lists the Flash models your key can see; set `GEMINI_MODEL` accordingly.
- **Announcements appear inside the assistant, not in the website's own alert inbox.** The website has no endpoint for custom announcements and this integration does not add such an endpoint. Delivery status is exact for what it does: published, how many accounts are eligible, how many have opened it.
- **Viewers cannot be told about floors**, because the website only exposes floors to administrators. Exposing a read-only building summary would be a small website change; it was not made.
- **Production embedding** needs the website's Content-Security-Policy to allow the script and frame from the assistant (or run both behind one origin), and both must be served over HTTPS under the same registrable domain because the session cookie is `SameSite=Strict` and `Secure`. Neither was changed.
- The assistant holds a person's session cookie only for the duration of a request and never logs it. Run it on the same trusted host as the website.
- Editing or deleting existing records, and cancelling or editing a booking by natural language beyond what Gemini can resolve to exactly one booking, are not supported.
- Conversation memory is in-process and per person (lost on restart); the visible history is kept per person in the browser tab.
- The 59-test count and 28-check count above were run once against this snapshot; re-run them after any change.
