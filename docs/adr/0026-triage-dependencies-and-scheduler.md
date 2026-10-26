# ADR-0026: Triage lane, stored dependencies and the scheduler

Status: Accepted · Date: 2026-10-26

## Context
MVP step 5 makes tasks flow without the operator starting them: a new task is triaged, waits for
what it needs, and starts when a slot frees (CONCEPTS.md §4–§5, ADR-0006, ADR-0007).

## Decision
- **Triage lane:** a task the operator creates is triaged by itself (`triage.requested` →
  `started` → `completed` | `failed`), one at a time, outside the slot pool. The `triage` agent
  (read-only tools, output contract `triage`) works in a detached worktree of the base branch's
  current commit, removed afterwards, and sees the open work of the project and the pipelines.
  Its answer is applied in one append: a `triage` decision (inputs: the whole answer and notes),
  the touch-set, the pipeline, a manual task plus a `manual` dependency for each manual task, and
  validated `code` dependencies by `#number`; unknown numbers and invalid dependencies are noted
  in the decision, not applied. The task then goes `backlog → ready`. A failed triage leaves the
  task in the backlog; the operator triages again or queues it without triage. Tasks created by
  agents (the manual tasks) are not triaged.
- **Dependencies** are stored per task (`dependency.added` / `removed` / `met`): `code` (a task or
  story merged), `manual` (a manual task done or verified) and `external` (a description, met by
  the operator or by an optional check command). Check commands are written only by the operator
  — triage never proposes commands — and run in the project's checkout with the operator's
  environment, at most once a minute each, while the task is blocked. Dependencies stay in one
  project, never point at the task itself or its story, and never form a cycle.
- **Collisions** are not stored: a ready task whose touch-set overlaps a running or merging task
  of the same project (directory prefixes; a glob covers its fixed prefix) waits, and the board
  shows the collision as an unmet requirement. An empty touch-set collides with nothing.
- **Scheduler**, one pass per relevant event and every 15 seconds:
  1. run due external checks; 2. reconcile `ready` ↔ `blocked` from the stored dependencies;
  3. end a due plan-limit pause; 4. while slots are free, take ready tasks in order (moved to
  front first, latest move first; then oldest), skip a capped project or a collision, revalidate
  dependencies and the base branch, and start the task's pipeline. A start that fails blocks the
  task with the reason. Runs the operator starts by hand still count against the slots.
- **Settings:** global slots (default 3) and pause are events in the `scheduler` stream; the
  per-project cap is `maxParallel` in the project settings.
- **Plan limit:** the Claude runtime marks a result as `limited` when Claude Code reports the usage
  limit; the run fails with "Plan limit reached…", the task fails with that reason, and the queue
  pauses for 30 minutes. When the pause ends (or the operator resumes), tasks failed by the limit
  go back to the queue.

## Consequences
- The board shows for every queued task exactly what it waits for.
- Revalidation checks dependencies and the base branch, not the touch-set; re-predicting the
  touch-set would need another agent call and is left for later.
- The 30-minute plan-limit pause is a guess; the reset time Claude Code reports is not parsed yet.
