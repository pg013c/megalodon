# Megalodon — Concepts

The vocabulary and the state model every other document, the code and the UI use. If code and
this document disagree, one of them is a bug.

## 1. Glossary

| Concept | Meaning |
|---|---|
| Project | A local git repository connected to Megalodon. `main` is its base branch. |
| Active project | The project the UI currently works in. Search and chat default to it. |
| Story | A user-visible piece of value on the board. Groups tasks. Has no status of its own. |
| Task | A unit of work an agent pipeline can finish and merge. May belong to a story or stand alone. |
| Manual task | Work only the operator can do (configure Stripe, create an API key). A node in the graph. |
| Dependency | A requirement a task needs met before it can start. See §4. |
| Touch-set | Files, modules and contracts a task is predicted to change. Drives collision detection. |
| Triage | The analysis of a new task by the triage agent: dependencies, touch-set, pipeline, manual tasks. |
| Agent | Persona, model, tools, instructions, permissions and output contract. Versioned. |
| Pipeline | A graph of agent steps and checks with retry and gate rules. Versioned. |
| Step | One node of a pipeline: an agent invocation or a deterministic check. |
| Run | One execution of a pipeline for a task, in its own worktree and branch. |
| Slot | Capacity for one concurrent run. The global limit is the number of slots. |
| Gate | A point where a policy decides whether work continues automatically or waits for the operator. |
| Policy | A project's setting for one gate: `auto`, `auto-if` (conditions) or `operator`. |
| Decision | A recorded choice by an agent, a policy or the operator, with its rationale. |
| Event | An immutable fact in the event log. Everything else is derived from events. |

## 2. Work model

```
Project
├── Story ──┬── Task
│           └── Task
├── Task              (standalone, no story)
└── Manual task       (with or without a story)
```

- Two levels only. A task without a story is normal (small fixes, chores).
- A story's status is **derived** from its tasks; nobody sets it.

## 3. Statuses

Statuses are projections of the event log. There is one status per item, and the board's columns
are these statuses — never a separate field. Every change is one `task.status_changed` event
(`from`, `to`, `reason`), and the projection refuses a transition these tables do not allow
(ADR-0023).

### Task

| Status | Meaning | Leaves to |
|---|---|---|
| `backlog` | Captured; triage pending or running, or held by the operator. | `blocked`, `ready`, `cancelled` |
| `blocked` | Triaged and queued; at least one dependency is unmet. The card lists them. | `ready`, `cancelled` |
| `ready` | All dependencies met; waits in the queue for a slot. | `running`, `blocked`, `cancelled` |
| `running` | A run is executing; the card shows the current pipeline step. | `merging`, `needs_you`, `failed`, `cancelled` |
| `needs_you` | Stopped at a gate or after exhausted retries; waits for the operator. | `running`, `merging`, `failed`, `cancelled` |
| `merging` | In the project's merge queue: rebase, checks, merge. | `done`, `needs_you` |
| `done` | Merged to `main`. Terminal. | — |
| `failed` | Ended without a result. Terminal, can be retried (a new run). | `ready` (retry) |
| `cancelled` | Stopped by the operator. Terminal. | — |

`ready` → `blocked` happens when revalidation before start finds a new unmet dependency.

### Manual task

| Status | Meaning | Leaves to |
|---|---|---|
| `todo` | Waits for the operator. Appears in **Needs you**. | `done`, `cancelled` |
| `done` | The operator marked it done. Satisfies dependants if the task has no verification. | `verified`, `todo` |
| `verified` | The automatic verification passed (e.g. the secret exists). Satisfies dependants. Terminal. | — |
| `cancelled` | No longer needed. Terminal. | — |

`done` → `todo` happens when the verification fails (with the reason) or when the operator reopens a
task marked done by mistake.

### Story (derived)

A story without tasks is `backlog`. Otherwise, in order of precedence:
1. `cancelled` — every task is cancelled.
2. `done` — every non-cancelled task is `done` / `verified`.
3. `needs_you` — any task is `needs_you` or `failed`, or a manual task is `todo`.
4. `running` — any task is `running` or `merging`.
5. `ready` — any task is `ready`.
6. `blocked` — any task is `blocked`.
7. `backlog` — otherwise.

## 4. Dependencies

Triage proposes dependencies; the operator can add, remove or override them. A dependency points at
a task or a story; a story dependency means "every task of that story is met".

| Kind | Met when | Example |
|---|---|---|
| `code` | The target task is `done` (merged to `main`). | Payments needs Users. |
| `collision` | No running or merging task shares the touch-set. Recomputed by the scheduler. | Two tasks change the same module. |
| `manual` | The target manual task is `done` or `verified`. | Payments needs a Stripe API key. |
| `external` | The operator marks it met, or its check command (written by the operator) passes. | The partner API is deployed to staging. |

**Revalidation before start:** when a task is about to take a slot, a short check confirms its
dependencies and touch-set against the current `main`. If something changed, the task goes back to
`blocked` and the reason is a decision in the log.

## 5. Queue and scheduler

- One global queue; the **global slot limit** caps concurrent runs on the host.
- When a slot frees, the scheduler starts the **oldest `ready` task** by creation time, across
  all projects. Tasks that are not ready are skipped but keep their place.
- **Per-project cap** (optional, default none): a project never holds more slots than its cap, so
  one large batch cannot starve other projects.
- **Move to front** is the only manual override of order.
- Manual tasks take no slot. Triage runs in its own small lane outside the slot pool.
- Each project's merge queue is serial and takes no slot.
- On a subscription plan limit the scheduler pauses starting new runs for 30 minutes, then puts the
  tasks the limit stopped back in the queue (ADR-0026).
- Runs the operator starts by hand bypass the order but count against the slots.

## 6. Gates and policies

Each project sets every gate in its settings (ADR-0028):

| Gate | Default | `auto-if` condition |
|---|---|---|
| Queue after triage | `auto` | Triage found no manual tasks. |
| Plan approval | `auto` | The plan's touch-set avoids sensitive paths. |
| Merge | `auto-if` | The gate passed, the review approved with at least the minimum score (7), no sensitive path changed. |
| Conflict resolution | `auto` (2 attempts) | — |
| Push `main` to remote | `operator` | — |

A gate that does not pass automatically records a `hold` decision and puts the task in
`needs_you`; the operator lets the work go on by overriding that decision. A run held at the plan
waits (`waiting`) without taking a slot.

## 7. Decisions

Every decision carries: actor (agent + version, policy, or operator), subject (task, run, step),
inputs, rationale, alternatives considered, and resulting events. An override is a new decision
that supersedes an earlier one; Megalodon then recomputes what depends on it (e.g. a removed
dependency makes a task `ready`).
