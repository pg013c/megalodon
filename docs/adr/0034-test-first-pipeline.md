# ADR-0034: Test-first pipeline

Status: Accepted · Date: 2026-11-24 · Builds on ADR-0005, ADR-0025, ADR-0033

## Context
Some projects require a red commit with failing tests and then a green commit with code that does
not touch the tests (offline-assistant, its ADR 0009). The `feature` pipeline has one implementer
step that writes tests and code together in one commit, and nothing stops an agent from changing a
test until it passes. Megalodon has no "command step" for pipelines and no project test command:
only the project's named checks (ADR-0015).

## Decision
- **Built-in pipeline `test-first`** (`library/pipelines/test-first.yaml`): `plan` → `red`
  (implementer, `tests: only`, `commitTypes: [test]`) → `red-check` (`check: project`,
  `only: [test]`, `expect: fail`, retry `red`) → `green` (implementer, `tests: locked`,
  `commitTypes: [feat, fix]`) → `checks` (retry `green`) → `review` (gate 7, retry `green` once).
  Its description names its prerequisites, so triage can tell when it fits.
- **Setting `testPaths`**: glob patterns of the project's test files, default `[]`. Settings stored
  before the field existed parse to `[]`; no migration.
- **Check-step options.** `only: [names]` runs only those project checks; `expect: pass | fail`
  (default `pass`). With `expect: fail` the step passes only when every required selected check
  exits non-zero; a passing check rejects the step (`test passed; expected it to fail`) with
  feedback that the new tests must fail against the current code; a timeout or a kill by a signal
  is not a failure of the tests and rejects it too (`test did not finish; expected it to fail`).
  Both expectations share one check loop and differ only in the verdict. A check step stands in for the task's "command step": it reuses check timeouts, logs,
  reports and `onFail` retries, and the project names its test command once, as the `test` check.
- **Agent-step options.** `tests: only | locked` guards the step's changes against `testPaths`;
  `commitTypes` restricts the commit type under Conventional Commits.
- **The guard's base.** When a guarded step starts, Megalodon snapshots the worktree as a tree
  object (`git add -A`, `git write-tree`, then the index is reset), so files earlier steps left
  behind (caches, coverage) are not blamed on it. The tree id is recorded in the attempt's
  `step.started` event (`base`). A resumed attempt and a retry of the step by itself (a guard or
  hook failure) reuse it; a retry from another step (checks, review) takes a new snapshot, because
  the step's previous attempt passed the guard and was committed. Agents are told not to commit,
  but one that does cannot move the base.
- **The guard.** Before the step's commit, Megalodon lists every path that differs from the base
  (committed or not, untracked, deleted, both sides of a rename). `locked` rejects any path
  matching a test glob; `only` rejects any path matching none. A violation fails the step
  (`Changed locked test files: …` or `Changed files outside the test paths: …`), commits nothing,
  and retries the same step in the agent's session with the paths, the globs and
  `git checkout <base> -- <path>` to restore them (which also undoes the agent's own commits), up
  to `maxFixPasses`, like a failing hook (ADR-0033). Restoring the files clears the violation.
- **Refused starts.** `buildPlan` copies `testPaths` into guarded steps and checks the pipeline fits
  the project before any worktree exists: a step naming a missing check fails with
  `CHECK_NOT_FOUND`, an `expect: fail` step without a required check too, and a guarded step
  without test paths with `NO_TEST_PATHS`. The scheduler turns that into a blocked task with the
  reason.
- **Commit types.** Under the conventional style a step with `commitTypes` keeps the agent's subject
  when its type is allowed, otherwise replaces the type with the first allowed one (keeping scope,
  `!` and summary); the fallback subject uses that type instead of `chore`. The prompt states the
  type. The Megalodon style is unchanged: red and green both get `#N <title>` subjects.
- **Prompts.** A fresh red prompt says to write failing tests only, overriding the implementer's
  usual "implement and make the checks pass"; a fresh green prompt lists the locked globs.
- **Globs.** `**/` now matches zero or more whole directories (`(?:.*/)?`) instead of any text, so
  `**/tests/**` matches `tests/a.ts` and `src/tests/a.ts` but not `src/contests/a.ts`. This also
  applies to sensitive paths and touch-set overlap.
- Planned steps gain defaulted fields (`expect`, `tests`, `testPaths`, `commitTypes`), so stored
  `run.started` events parse unchanged (ADR-0025).

## Consequences
- The red gate only sees exit codes. Tests that fail for an unrelated reason (a syntax error, a
  missing dependency) pass it; the check output is in the run timeline for the review and the
  operator.
- Red cannot add helpers or fixtures outside `testPaths`; projects glob those too.
- Green and its review retries cannot fix a wrong test. Such runs end in *Needs you* and the
  operator fixes the test.
- A guard violation leaves an uncommitted worktree; a run that runs out of retries goes to *Needs
  you* with it.
- A test change the agent committed itself and then restored stays in the branch history (a commit
  and its revert); the branch's content is what the guard checked.
- The base tree is not referenced by any ref; `git gc` prunes such objects only after two weeks, far
  longer than a step.
- The stricter `**/` may let a sensitive-path glob that relied on the loose match stop matching.
