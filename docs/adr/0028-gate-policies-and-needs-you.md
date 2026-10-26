# ADR-0028: Gate policies per project, parked runs and the Needs you view

Status: Accepted · Date: 2026-10-26 · Builds on ADR-0009

## Context
MVP step 7 lets each project decide where work flows by itself and where it stops for the
operator, and gives the operator one place that lists everything waiting for them.

## Decision
- **Policies** live in the project settings (`policies`), one per gate, with defaults filled in
  for settings stored before they existed (settings are parsed on read):

  | Gate | Modes | `auto_if` passes when | Default |
  |---|---|---|---|
  | `queue` (after triage) | auto, auto_if, operator | triage found no manual tasks | auto |
  | `plan` (after the plan step) | auto, auto_if, operator | the plan's touch-set avoids sensitive paths | auto |
  | `merge` (after a run) | auto, auto_if, operator | the gate passed, the review approved with ≥ `minScore`, no sensitive path changed | auto_if, 7 |
  | `conflicts` (merge queue) | auto (`attempts`), operator | — | auto, 2 |
  | `push` (after a merge) | auto (`remote`), operator | — | operator |

- Every gate records a decision (`queue`, `plan`, `merge`) with the policy as actor
  (`policy:<gate>`) and the alternatives; **the operator acts by overriding it**: `hold → queue`
  queues a triaged task, `hold → approve` continues a parked run, `hold → merge` (or the Merge
  button) queues a merge. The triage decision itself only records the analysis (`triaged`).
- **Parked runs:** a held plan ends the executor without an outcome; the run becomes `waiting`
  (`run.waiting`), takes no slot and is not resumed on restart; the task goes to `needs_you`.
  Approval appends `run.resumed`, the task returns to `running` and the run continues after the
  plan. Cancelling the task cancels a parked run.
- **Push:** `git push <remote> <base>` in the operator's checkout with their credentials; a failed
  push never undoes the merge and is reported in the task's reason (`merge.push_failed`).
- **Needs you** is derived, not stored: tasks in `needs_you` (a parked plan, or a held or failed
  merge, with the decision to override and whether the run can be merged), failed tasks, manual
  tasks to do, backlog tasks whose triage failed or whose queue decision holds them, projects whose
  merges wait for the checkout, and a paused queue. Oldest first; the navigation shows the count.

## Consequences
- One project can run fully on its own while another asks before every merge.
- A parked run keeps its worktree but not a slot; collisions with it are not checked while it
  waits.
