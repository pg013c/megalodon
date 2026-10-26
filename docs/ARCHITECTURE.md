# Megalodon — Architecture

Status: draft v0.2 · Last updated: 2026-10-26

## 1. Overview

```
            Browser (web UI)                Claude / other clients
                  │  HTTP + SSE                     │  MCP
                  ▼                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│ Server (Node, TypeScript, 127.0.0.1)                             │
│                                                                  │
│  API ───────────► Commands ──► Event log (SQLite, append-only)   │
│   ▲                                   │                          │
│   │                                   ▼                          │
│   └──────────── Queries ◄──── Projections (statuses, graph,      │
│                                 metrics, timelines)              │
│                                                                  │
│  Triage lane   Scheduler ──► Run executor ──► Merge queue        │
│                    │             │    ▲             │            │
│                    │             ▼    │             ▼            │
│                    │       Agent runtime (Claude Agent SDK)      │
│                    │             │                               │
│  Library (agents, pipelines)     │       Integrations (git, gh,  │
│  versioned files                 │       AWS, Keychain)          │
└──────────────────────────────────┼───────────────────────────────┘
                                   ▼
                    Project worktrees (one per run)
```

## 2. Stack

- **TypeScript** on Node, pnpm workspace: `apps/server`, `apps/web`, `packages/*` for shared
  contracts.
- **SQLite** for all state.
- **Claude Agent SDK** behind an `AgentRuntime` interface.
- Web UI: React + Vite; live updates over server-sent events.
- Library choices beyond these (HTTP framework, ORM/query builder, UI kit) are decided in step 0 of
  `MVP.md` and recorded as ADRs.

## 3. Event log and projections

The event log is the only source of truth (ADR-0003).

- Every state change is an event: `task.created`, `triage.completed`, `dependency.added`,
  `run.started`, `step.completed`, `decision.made`, `decision.overridden`, `merge.completed`, …
- Events are appended in a transaction together with the projection updates they cause, so
  projections are never behind the log in a committed state.
- Projections are plain SQLite tables shaped for queries: current status of every item, the
  dependency graph, the queue, per-run timelines, cost and time aggregates.
- Projections can be rebuilt from the log; a rebuild is part of the test suite.
- Commands validate against current projections, decide, and append events. Nothing else writes.

## 4. Library: agents and pipelines

Agents and pipelines are files (ADR-0005), in two places:

- `library/` in the Megalodon repository: built-in defaults.
- `<data dir>/library/`: the operator's own and edited definitions, a git repository of its own so
  every change is a version.

An **agent** is a Markdown file with front matter:

```markdown
---
id: implementer
name: Implementer
model: claude-opus-5-5
tools: [read, edit, bash, mcp:context7]
permissions: { network: false, paths: [worktree] }
output: schemas/implementation-result.json
---
You are a senior engineer who implements an approved plan in small, tested steps…
```

A **pipeline** is a YAML file:

```yaml
id: feature
name: Feature
steps:
  - id: plan
    agent: planner
  - id: implement
    agent: implementer
  - id: checks
    check: project.checks        # tests, lint, typecheck from project settings
    onFail: { retry: implement, max: 2 }
  - id: review
    agent: reviewer
    gate: merge                  # evaluated against the project's merge policy
```

Each run records the content hash of every agent and pipeline it used; evaluation groups by these
versions.

## 5. Agent runtime

```ts
interface AgentRuntime {
  run(input: {
    agent: AgentDefinition;
    cwd: string;              // the run's worktree
    prompt: string;           // task + upstream artifacts
    signal: AbortSignal;
  }): AsyncIterable<RuntimeEvent>;   // messages, tool calls, usage, final artifact
}
```

Only the Claude implementation exists (ADR-0012). It uses the operator's local Claude login
(subscription). Tool access, MCP servers and permissions come from the agent definition only;
the operator's integrations are never passed through (ADR-0010).

## 6. Triage

A dedicated lane (one concurrent triage, outside the slot pool) runs the triage agent for each new
task. Input: the task, the project's backlog and in-progress tasks with touch-sets, the knowledge
base, and read-only access to `main`. Output (contract): dependencies, touch-set, pipeline,
proposed manual tasks, rationale. Each field becomes a decision.

## 7. Scheduler

Pure function over projections, called on every relevant event:

```
free = globalSlots - running
for task in ready tasks ordered by (frontOverride desc, createdAt asc):
    if free == 0: break
    if project cap reached: continue
    if collides with a running/merging touch-set: continue
    revalidate(task) → start run, or back to blocked
```

The scheduler is paused while a plan limit is active and resumes when it resets.

## 8. Runs

- One git worktree and branch per run, created from the task's base ref (`main` by default).
- **Isolation:** each run gets an allocated port range and an environment file; setup and teardown
  commands (install, test database) come from the project settings (ADR-0015).
- The executor walks the pipeline, calls the runtime for agent steps and runs checks as processes,
  appending events for every message, tool call, usage report and decision.
- **Restart safety:** on startup, runs that were active are resumed at the last completed step, or
  failed with a reason when that is not possible.

## 9. Merge queue

One serial queue per project:

1. Detect conflicts with `main` without touching any checkout (`git merge-tree`).
2. Bring the task branch up to date with `main` in the run's worktree.
3. Re-run the project checks.
4. Evaluate the merge gate.
5. Check the operator's checkout: on `main`, no uncommitted tracked changes. Otherwise the queue
   waits and **Needs you** says why.
6. `git merge --no-ff` in the operator's checkout (ADR-0014); record `merge.completed`; clean up the
   run worktree.

Conflict or failed checks: the conflict agent tries up to two times, then `needs_you`.

## 10. Integrations

Connectors behind one interface: `status()` (connected / needs login), and capability methods.

- Git: the operator's `git` credentials.
- GitHub: the `gh` CLI session. Bitbucket: an API token in the Keychain.
- AWS: named profiles from `~/.aws` (SSO); CloudWatch Logs Insights for error counts and logs.
- Expired sessions surface as "log in again" on the dashboard.

## 11. API, MCP and chat

- The HTTP API is the only way into the server; the UI uses it.
- The same commands and queries are exposed as an MCP server, so the in-app chat agent and any
  external Claude client can operate Megalodon.
- The chat agent receives the UI context (active project, branch, open item) with every message.

## 12. Instances

- **Stable**: runs a tagged build from `<data dir>/releases/<tag>`, port `4600`, data dir
  `~/.megalodon`. Merges to Megalodon's own `main` never touch it; upgrading is an explicit
  operator action (ADR-0013).
- **Dev**: runs from a checkout with a throwaway data dir and free ports.
- A lock file in the data dir prevents two servers from sharing it.

## 13. Project settings and knowledge

- **Settings** (checks, worktree setup, sensitive paths, gate policies, knowledge path) live in
  Megalodon's database, detected on connect and edited in the UI; nothing is written to the
  project (ADR-0015).
- **Knowledge base**: files committed to the project, by default `docs/`, updated by agents through
  the normal merge flow; optionally kept outside the repository (ADR-0016).

## 14. Open questions

None at the moment.
