# Megalodon — Product Requirements

Status: draft v0.1 · Owner: Przemo · Last updated: 2026-10-26

## 1. Problem

A technical lead who supervises several software projects at once, with AI agents doing most of
the implementation, has no single place to work. Tasks live in one tool, agent sessions in
terminals and chat windows, branches and pull requests in a git host, logs in a cloud console and
costs nowhere. Every task needs the human to start it, approve it, merge it and rebase what comes
after it, so the human becomes the bottleneck and parallel work across projects stops scaling.

## 2. Vision

**Megalodon** is a private, local command centre for one operator who leads many projects
through AI agents. The operator drops work into a project; Megalodon analyses what that work
depends on, places it in a dependency graph, runs it through an agent pipeline in an isolated
worktree when its turn comes, and merges it to `main` — automatically wherever the project's
policies allow. The operator sees the state of every project at a glance, knows exactly what
waits for them, can read every decision any agent made, and can overturn any of them.

Megalodon is meant to be the operator's **only place of work**: dashboard, board, agent studio,
code review, logs and chat in one calm interface.

## 3. User

- **Operator** (the only user): a senior developer acting as supervisor, team lead and technical
  owner of 5–10 projects, each with 10–20 tasks in flight.
- Multi-user and shared instances are out of scope.

## 4. Principles

1. **Plan before run.** Dependencies are found and recorded before a task starts, never discovered
   halfway through.
2. **Automatic by default, gated by risk.** Every step that can run without a human does; gates
   exist only where a project's policy asks for them.
3. **Everything is visible and reversible.** Every decision is recorded with who made it, why and
   what it caused; the operator can override any decision.
4. **Status is a fact, not a guess.** Progress is the run's real position in its pipeline, never an
   estimate.
5. **No external plugin dependencies.** Agents and pipelines are Megalodon's own definitions.
6. **One focus per screen.** The interface shows one important thing per screen and hides detail
   behind drawers, modals and links.
7. **Within reason.** Parallelism is bounded by the host machine and the subscription's limits;
   Megalodon makes the best use of them rather than pretending they do not exist.

## 5. Functional requirements

### FR-1 Projects and work context
- Connect a local git repository as a project.
- One **active project** is the working context of the UI; switching is one action.
- `main` is always the base: tasks branch from it and merge back to it.
- Browse any branch (local or fetched from the remote) and see its diff against `main`.
- Start an agent or a pipeline on a chosen branch, not only on `main`.

### FR-2 Global overview
- One screen shows every connected project without switching context.
- First: **Needs you** — everything waiting for the operator across projects (manual tasks,
  decisions, failed runs, gates).
- Then one card per project: running tasks with their current pipeline step, counts of
  ready / blocked / done, cost and agent time for the period, error count from logs (when an
  integration is connected).

### FR-3 Project dashboard and board
- Project overview: progress of stories, what runs now, what waits and on what, cost and time,
  health signals from integrations.
- Board of stories and tasks by status; each item shows **what it needs to start** and the state of
  each requirement.
- Dependency graph view of the project.

### FR-4 Intake and triage
- Add stories and tasks from the UI, from chat or through the API.
- Every new item is triaged by an agent persona ("tech lead") that reads the backlog, work in
  progress and `main`, then proposes: dependencies, predicted touch-set, pipeline, and manual tasks
  the work requires (e.g. "create a Stripe API key").
- Triage results are decisions in the log and can be overridden.

### FR-5 Dependency graph
- Dependencies point to a task or a story (a story dependency means all its tasks are merged).
- Kinds: code, collision, manual, external (see `CONCEPTS.md`).
- Manual tasks are first-class nodes on the board and in the graph.
- Before a task starts, its plan is revalidated against the current `main`.

### FR-6 Queue and scheduler
- One global queue with a global limit of concurrent runs.
- Order: the time a task was added, skipping tasks that are not ready.
- Optional per-project cap; manual "move to front" as the only override of order.
- The operator sees what runs now and what waits, and why.

### FR-7 Agents
- An agent is persona, model, tools (MCP servers, CLIs), instructions, permissions and an output
  contract.
- Agents are created and edited in the UI and stored as versioned files.
- An agent never inherits the operator's credentials; its access comes from its definition.

### FR-8 Pipelines
- A pipeline is an ordered graph of agent steps and deterministic checks (tests, lint, build),
  with retry and gate rules.
- Every pipeline is visible in the UI as a diagram; every run shows its position in it.
- Pipelines are versioned files, editable in the UI.

### FR-9 Runs
- Every run works in its own git worktree and branch of the project; agents never write to the
  operator's checkout.
- Runs are isolated from each other (ports, databases, caches).
- A run streams its events live; cost, tokens and duration are recorded per step.
- Runs survive a restart of Megalodon and resume or fail cleanly.

### FR-10 Merge
- A finished task enters the project's merge queue: update from `main`, re-run checks, merge in
  the operator's checkout so it always reflects `main`.
- If the checkout is not on `main` or has uncommitted changes, the project's merges wait and
  **Needs you** says why; Megalodon never stashes or resets the operator's work.
- On conflict or failed checks a conflict-resolution agent tries up to two times; then the task
  goes to **Needs you**.
- After a merge, dependants become ready and the next task starts.

### FR-11 Automation policies
- Per project, every gate (start, plan approval, merge, conflict resolution, push to remote) is
  set to automatic, automatic-with-conditions, or operator.
- Conditions are risk based: e.g. auto-merge when checks pass, review score is at least N and the
  touch-set avoids sensitive areas (payments, auth, migrations).
- Release to production is out of scope for now; the flow ends at `main`.

### FR-12 Decision log and overrides
- Every decision — by an agent, a policy or the operator — is recorded with actor, inputs,
  rationale, alternatives and consequences.
- Every task, run and step has a readable timeline built from that log.
- The operator can override a decision; Megalodon recomputes what depends on it.

### FR-13 Evaluation
- Every run records the version of each agent and pipeline it used.
- Per agent and per pipeline version: success rate, rework, cost, time, operator overrides.
- Golden task sets per agent to compare versions before adopting a change.

### FR-14 Integrations
- Git remote: fetch branches, see pull requests and CI state (GitHub, Bitbucket).
- AWS: error counts for the dashboard, log viewer on demand (CloudWatch).
- Integrations reuse the operator's local logins where they exist (`git`, `gh`, AWS profiles) and
  the macOS Keychain otherwise.

### FR-15 Search
- Search stories, tasks, decisions and runs in the active project by default; one switch makes it
  global.

### FR-16 Project knowledge
- Each project has a knowledge base of business decisions and ADRs that agents read and update,
  so the same feature in two projects never mixes context.
- It is a folder committed to the project (default `docs/`), or kept outside the repository for
  projects that should not receive such files.

### FR-17 Chat
- A chat inside Megalodon, aware of the active project, branch and open item.
- The chat agent uses Megalodon's own API as its tools: create tasks, answer questions about state,
  explain and override decisions.

### FR-18 Interface
- Clean, Apple-like: one focus per screen, details in drawers and modals, `Cmd+K` for everything.
- Main screens: Overview, Project, Task, Agents & Pipelines, Needs you.

## 6. Non-functional requirements

- Local only: binds to `127.0.0.1`, no authentication, single operator.
- Stays responsive with 10 projects and 200 tasks in the graph.
- SQLite storage; the event log is the source of truth.
- Agents run on the operator's Claude subscription through the Claude Agent SDK; the scheduler
  pauses on plan limits and resumes after them.
- Runtime interface open to other agent SDKs later; only Claude is implemented.

## 7. Out of scope (for now)

- Multiple users, remote or cloud workers.
- Automated release to production.
- Agent SDKs other than Claude.
