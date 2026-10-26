# ADR-0027: The merge queue

Status: Accepted · Date: 2026-10-26 · Builds on ADR-0008 and ADR-0014

## Context
MVP step 6 closes the loop: work that passed its pipeline lands on the base branch without the
operator, and what depends on it can start.

## Decision
- **Entering the queue.** When a run succeeds, a `merge` decision (policy `merge-gate`) is
  recorded: `merge` when the run's effective gate passed and no changed file matches the project's
  sensitive paths; otherwise `hold`, and the task goes to `needs_you` with the reason. A pipeline
  without a gate always holds. The operator sends a held task to the queue with **Merge**
  (a `merge` decision by the operator), or by overriding a failed gate to `pass` or a `hold` to
  `merge`. A run that failed only because checks or the review never passed can be merged this way;
  the task's newest run is the one merged.
- **Serial per project, parallel across projects.** For the oldest `merging` task:
  1. if its branch is already on the base (a merge that landed before a restart): clean up, done;
  2. if the base moved: predict conflicts with `git merge-tree` (no work tree touched), merge the
     base into the branch in the task's worktree, let the `resolver` agent settle conflicts (two
     attempts; files must be free of conflict markers), then run the project's setup and checks
     again; failure aborts the update and sends the task to `needs_you`;
  3. check the operator's checkout (ADR-0014) and `git merge --no-ff` the branch there with the
     operator's identity, message `Merge #<n> <title>`;
  4. remove the worktree and the branch; the task becomes `done` ("Merged as <sha>").
- **The checkout is the operator's.** Not on the base branch, a merge in progress, or uncommitted
  changes to tracked files: the project's merges wait, a `merge.blocked` event records why, and the
  queue panel shows it until the checkout is clean (`merge.unblocked`). Megalodon never stashes,
  resets or switches branches.
- **Recovery.** On startup, a merge left in a task's worktree is aborted; a merge left in the
  checkout is aborted only when `MERGE_HEAD` is exactly that task's branch tip; then the queue
  continues, and a branch already on the base is reconciled as done.
- **History.** `merge.started`, `updated`, `conflict`, `resolved`, `completed`, `failed`,
  `recovered` go to `task:<id>`; blocks go to `merge:<project>`.
- Merging does not take a slot (CONCEPTS.md §5); a merging task still collides with ready tasks
  that touch the same files. A task becoming `done` makes the scheduler re-evaluate its dependants.

## Consequences
- With the defaults, a task with a passing review and no sensitive paths goes from the queue to
  the base branch without the operator.
- Pushing the base to a remote stays manual (policy `operator`, CONCEPTS.md §6).
