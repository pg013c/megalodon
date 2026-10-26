# ADR-0014: Merges happen in the operator's checkout, guarded

Status: Accepted · Date: 2026-10-26 · Amends ADR-0008

## Context
Advancing `main` while the operator has it checked out would leave their working tree out of step
with the branch. The earlier prototype solved this by merging in the main checkout itself, so the files on disk always
matched `main`, and it worked well. The earlier prototype merged only on an operator action; Megalodon merges
automatically.

## Decision
- The merge queue's final step runs `git merge --no-ff` **in the project's main checkout**. This is
  the only write Megalodon makes there, and it is done by the server, never by an agent.
- Conflicts are detected first without touching the checkout (`git merge-tree`); a conflicting
  branch never reaches it and goes to the conflict agent instead.
- The merge is refused when the checkout is not on `main` or has uncommitted changes to tracked
  files. The project's merge queue then waits and **Needs you** shows "commit or stash your
  changes" (or "switch back to `main`"). Megalodon never stashes, resets or switches branches for
  the operator.
- A merge interrupted by a restart is aborted in the checkout only if `MERGE_HEAD` is exactly that
  task's branch tip; a merge that already landed is reconciled as done.
- Merge commits use the operator's git identity.

## Consequences
- The operator's checkout always reflects `main`.
- Working directly in the checkout on `main` pauses that project's merges until the work is
  committed; this is visible, never silent.
- Closes `ARCHITECTURE.md` open question 1.
