# ADR-0015: Project settings live in Megalodon, detected on connect

Status: Accepted · Date: 2026-10-26

## Context
Runs need per-project settings: checks (tests, lint, typecheck), worktree setup, sensitive paths
and gate policies. The earlier prototype kept these in its own database, edited in the UI, with dependency
installation detected from the lockfile, and needed no file in the project.

## Decision
- Project settings are stored in Megalodon's database and edited in the project's settings screen.
- On connect, Megalodon detects sensible defaults: the package manager from the lockfile with a
  frozen install as worktree setup, and check commands from the project's scripts. The operator
  confirms or edits them.
- Checks are an ordered list (name, command, required, timeout) with a fix-pass limit; they are
  run by Megalodon, and their results — not an agent's claim — decide the merge gate.
- No settings file is written to or required in the project repository. A file may be added later
  if needed.

## Consequences
- Connecting a client project leaves no trace in its repository.
- Closes `ARCHITECTURE.md` open question 2.
