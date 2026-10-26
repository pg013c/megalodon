# ADR-0008: Worktree per run and a serial merge queue per project

Status: Accepted · Date: 2026-10-26

## Context
Many tasks of one project run in parallel; the operator's checkout must stay untouched and `main`
must stay green when merges are automatic.

## Decision
- Every run works in its own git worktree and branch, created from the task's base ref.
- Finished tasks enter a serial merge queue per project: rebase on `main`, re-run checks, evaluate
  the merge gate, merge.
- On conflict or failed checks a conflict agent tries up to two times, then the task goes to
  `needs_you`.

## Consequences
- `main` only ever receives changes tested on top of the current `main`.
- Where the merge itself happens is decided in ADR-0014.
