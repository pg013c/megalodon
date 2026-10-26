# Megalodon — MVP

The MVP is done when **Megalodon develops itself**: the operator says in chat "add tasks X, Y and Z
to the Megalodon backlog", and those tasks are triaged, queued, run, reviewed and merged to
Megalodon's `main` with green checks, with no operator action unless a policy gate asks for one.

The current step is the first with unchecked criteria. Each step ends with `pnpm typecheck` and
`pnpm test` passing.

## Step 0 — Skeleton
- [x] pnpm workspace with `apps/server`, `apps/web`, `packages/contracts`.
- [x] Library choices (HTTP framework, SQLite access, UI kit, test runner) recorded as ADRs.
- [x] Server on `127.0.0.1`, configurable port and data dir, data-dir lock file.
- [x] Event store: append + projections in one transaction; projection rebuild test.
- [x] Web shell with the five main screens as empty routes and `Cmd+K`.

## Step 1 — Projects and context
- [x] Connect a local git repository as a project; reject non-repositories.
- [x] Project settings detected on connect (package manager, worktree setup, checks) and editable
      (ADR-0015), including the knowledge base path (ADR-0016).
- [x] Active project switch; persisted.
- [x] Branch list (local and fetched) with diff against `main`.

## Step 2 — Stories, tasks and statuses
- [x] Create stories, tasks (with or without a story) and manual tasks.
- [x] Task and manual task statuses as projections exactly as in `CONCEPTS.md` §3.
- [x] Derived story status with a test for every precedence rule.
- [x] Board of the active project by status; manual tasks visible and completable.

## Step 3 — Agent runtime and runs
- [x] `AgentRuntime` with the Claude Agent SDK implementation.
- [x] Agent definitions loaded from `library/` and the data-dir library; content hash recorded.
- [x] A single-agent run in its own worktree, events streamed to the UI live.
- [x] Cost, tokens and duration recorded per step.
- [x] Runs active at shutdown are resumed or failed with a reason on startup.

## Step 4 — Pipelines and decisions
- [x] Pipeline YAML with agent steps, checks, retry and gate rules.
- [x] Default `feature` pipeline: plan → implement → checks → review.
- [x] Run timeline: position in the pipeline, every message, tool call and decision.
- [x] Decisions recorded with actor, rationale and alternatives; operator override as a new decision.

## Step 5 — Triage, dependencies and scheduler
- [x] Triage lane and triage agent producing dependencies, touch-set, pipeline and manual tasks.
- [x] All four dependency kinds; story dependencies; card shows what a task needs to start.
- [x] Global queue with slot limit, creation-time order, per-project cap and "move to front".
- [x] Revalidation before start; collision detection on touch-sets.
- [x] Pause on plan limit and resume after it.

## Step 6 — Merge queue
- [x] Serial merge queue per project: conflict detection, update from `main`, checks, gate, merge in
      the operator's checkout (ADR-0014), worktree cleanup.
- [x] Dirty checkout or checkout off `main` pauses the project's merges and shows in Needs you.
- [x] A merge interrupted by a restart is aborted or reconciled on startup.
- [x] Conflict agent with two attempts, then `needs_you`.
- [x] Merged task makes its dependants `ready`.

## Step 7 — Policies and Needs you
- [x] Project settings section with every gate's policy and its conditions.
- [x] Needs you screen across projects: gates, failed runs, manual tasks.

## Step 8 — Overview
- [x] Global Overview: Needs you on top, one card per project (running tasks with their step,
      ready / blocked / done counts, cost and agent time).

## Step 9 — API, MCP and chat
- [x] All commands and queries exposed over MCP.
- [x] In-app chat agent using that MCP, aware of the active project and open item.
- [ ] Stable instance from a tagged build (ADR-0013); Megalodon connected to itself as a project.
- [ ] **Self-hosting check:** three tasks added through chat are merged to Megalodon's `main`.

## After the MVP
Evaluation (agent and pipeline versions, golden sets), integrations (GitHub, Bitbucket, AWS logs),
search, project knowledge base, project dashboard health signals, pipeline editor UI, other agent
runtimes, release flow.
