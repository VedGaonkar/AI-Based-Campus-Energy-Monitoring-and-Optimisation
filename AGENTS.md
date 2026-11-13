# Repository instructions

## Continuity and session recovery

Read [HANDOFF.md](HANDOFF.md), [PROGRESS.md](PROGRESS.md) and [TASKS.md](TASKS.md) at session start, then reconcile them with actual source, Git status and running services. PROGRESS.md holds concise history/current task; HANDOFF.md holds the latest actionable resume snapshot. Checkpoint after meaningful increments, failed verification, before lengthy/risky operations, approximately every five minutes and before ending a session. Record task IDs, results, limitations and next steps without secrets or private reasoning. Preserve pre-existing working-tree changes. Do not commit, push, merge, deploy or publish unless explicitly authorised.

## Authority and current state

Read [PLAN.md](PLAN.md) completely before implementation, then inspect the repository. It defines the intended direction; source code and executed checks determine what is actually implemented. Resolve supporting documentation conflicts in favour of the plan, and record any ambiguity rather than inventing behaviour. Preserve the plan unless the task explicitly authorises changing it.

Implementation began on 13 November 2026. The repository now contains JavaScript workspaces, a Mongo-backed API/worker, React UI, shared contracts, seed fixtures and application tests. Read HANDOFF.md and PROGRESS.md for the current checkpoint; do not rely on the earlier documentation-only baseline. Skill scripts/tests remain unrelated to application verification. Preserve the nine Markdown files already modified before implementation began.

## Scope and implementation rules

- Build for one college building and selected rooms/common areas. Do not add multi-building/tenant management or cross-building comparisons.
- Use JavaScript for the web application and Node backend; reserve Python for vision/OCR. Follow the [selected stack](PLAN.md#9-recommended-software-stack) and verify compatible supported versions before installing dependencies.
- Keep policy, permissions, scheduling and commands in the backend. The browser and Python service never decide to cut power.
- Build CSV/manual meter ingestion, timetable handling, analytics, recommendations and assigned action tracking before optional hardware work. Core operation must not depend on inference, SMTP, MQTT, Home Assistant, an LLM or paid services.
- Treat the [repository layout](PLAN.md#191-suggested-repository-layout) as proposed until directories exist. Define shared contracts before integrations. Document only start/build/seed/test commands that actually exist.
- Preserve unrelated source/configuration, useful documentation and reusable tooling. Keep each document focused on its purpose and link to the plan instead of copying it in full.

## Required control and evidence invariants

- Exactly one independently controlled Wi-Fi smart master breaker maps to each controlled room. Inventory describes loads and estimates, not independent light/fan/socket/AC controls. No IR blasters, smart plugs, per-button modules or separate ESP32 mains actuator.
- Keep downstream protection, physical switches and independently maintained camera/sensor/network/essential supplies. Installation requires qualified electrical review. An incompatible downstream load blocks the whole room cutoff; enforce AC normal-stop and restart requirements.
- Start rooms alert-only and hardware in simulation. Enforce `DEMO_MODE` and `ALLOW_PHYSICAL_CONTROL` on the server/gateway. Fixtures, replay and accelerated clocks must never authorise physical commands.
- Use explicit ON/OFF commands with request IDs, expiry, interlocks and current-policy checks. Restore only an eligible supply deliberately disabled by this automation; never reset fault trips, maintenance lockouts or manual isolation.
- Keep observed occupancy, authorised-use protection, breaker supply and appliance observations separate. Fresh positive presence protects; inadequate coverage, stale sources or uncertainty block vacancy shutdown.
- After the configured vacancy confirmation (initially 15 minutes), alert at t=0, escalate at t=10 minutes, then recheck at t=25 minutes. Persist jobs/outbox in MongoDB with a separate worker; do not rely on browser timers or long in-memory timeouts.
- Bookings/preparation windows, QR leases, overrides, new occupancy and policy changes invalidate obsolete work. Acknowledgement is not resolution; lease expiry is not evidence of vacancy. No-source expiry defaults to staff confirmation; any physical fixed-duration policy needs separate approval and override rules.
- Preserve source labels: Metered, Camera-observed, Sensor-reported, Estimated, Simulated and Unknown. A building meter cannot identify unmetered room kWh. A simulated/controller-reported result is not independently verified shutdown or savings.
- Handle meter epochs, gaps, units, duplicates and baseline limitations explicitly. Avoid overlapping savings estimates and unsupported causal claims.

See [SECURITY.md](SECURITY.md), [DATABASE.md](DATABASE.md) and [TESTING.md](TESTING.md) for the corresponding access, persistence and acceptance requirements.

## Documentation lookup

For library/framework/SDK/API/CLI/cloud-service syntax, configuration, setup, migration or library-specific debugging, use the Context7 CLI before relying on remembered APIs. This is not required for documentation auditing, general concepts, business-logic debugging, code review or refactoring that does not depend on library-specific behaviour.

1. Resolve the official library name: `npx ctx7@latest library <name> "<specific lookup>"`. Call `library` first unless a `/org/project` ID is supplied. Pick the best exact/relevant match using reputation, snippet count and benchmark score; try an alternate query if needed.
2. Fetch with `npx ctx7@latest docs <libraryId> "<specific concept>"`. Use separate concepts unless their interaction is the question; use a versioned ID from the resolver for version-specific work.
3. Use at most three commands per question and base guidance on fetched documentation. Never put credentials in queries.

Run Context7 requests outside the default sandbox through the available approval mechanism. If a request encounters DNS/network failure, rerun outside the sandbox rather than retrying inside. On quota errors, tell the user and suggest `npx ctx7@latest login` or `CONTEXT7_API_KEY`; do not silently fall back to memory. These are documentation-tool commands, not application scripts.

## Local skills and maintenance

The 57 Markdown files under `.agents/skills/` are reusable design instructions, references and templates. Use a skill only when it fits the task. Their examples of other stacks (including TypeScript, Next.js, shadcn, Chart.js or older Tailwind setups), sample brands, external paths and generated asset conventions do not change this project's choices. Resolve their file references against the actual installed skill directory; a generic `.claude/skills/` example is not an existing project path. Do not introduce a conflicting framework or create design deliverables merely because a skill example contains them. Optional paid design-tool APIs do not become core application dependencies.

For documentation-only work, audit those files for project relevance and leave reusable technical material intact unless a specific correction is needed. For implementation, update the relevant existing project docs as features land, disclose missing integrations, and record exact verification results. Do not create a parallel `docs/` tree just because it appears in the proposed layout.

Validate meaningful policy/calculation/API/failure cases from [PLAN.md section 21](PLAN.md#21-acceptance-checks). Report separately what changed, which checks actually ran and which application behaviour remains untested. Never fabricate dependency versions, fixtures, physical-control success or test results.
