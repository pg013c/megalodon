# ADR-0023: One status-change event, enforced by the projection; per-project numbers

Status: Accepted · Date: 2026-10-26

## Context
Step 2 introduces stories, tasks and manual tasks. Most task transitions will be caused later by
triage, the scheduler, runs and the merge queue; all of them must respect the state machine in
`CONCEPTS.md` §3, which the earlier prototype's drifting statuses taught us to guard strictly.

## Decision
- **One event for every status change:** `task.status_changed { id, from, to, reason }`, with the
  actor that caused it. Domain events added later (a run started, a merge finished) are appended in
  the same transaction as the status change they cause.
- **Enforced twice:** `WorkService.transition` refuses an invalid change with
  `409 INVALID_TRANSITION`, and the projection throws on any event whose `from` is not the current
  status or whose transition is not in the table, so an invalid change can never be committed to the
  log, whoever appends it.
- The transition tables and `deriveStoryStatus` live in `packages/contracts`, shared by server and
  UI; the UI shows only the actions the table allows.
- **Story status is computed at read time** from its tasks and never stored.
- Clarifications to `CONCEPTS.md`: a manual task can be `cancelled`; the operator can reopen a
  manual task (`done` → `todo`); a `failed` task makes its story `needs_you`; a story without tasks is
  `backlog`.
- **Numbers:** stories and tasks share one per-project sequence (`#1`, `#2`, …), decided by the
  command and carried in the creation event, so a rebuild reproduces them.
- **History:** a task's history is its event stream (`task:<id>`), served with the task.

## Consequences
- Board columns, story status and history always agree with the log.
- Steps 3–6 add transitions only through `WorkService.transition`.
