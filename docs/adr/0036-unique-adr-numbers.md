# ADR-0036: Unique ADR numbers

Status: Accepted · Date: 2026-11-24 · Builds on ADR-0027

## Context
Tasks #14 and #16 ran in parallel worktrees and both wrote ADR-0033: each agent took "the next free
number" from its own copy of `docs/adr`, and neither the checks nor the merge queue noticed when
the second one landed. References to "ADR-0033" then meant two different decisions.

## Decision
- **ADR numbers are unique.** In a project, no two files `docs/adr/NNNN-*.md` share a number. The
  duplicate from #14 and #16 is resolved by merge order: the scorecard ADR (#14, merged first)
  keeps 0033, the commit-conventions ADR (#16) becomes ADR-0035, and its references follow.
- **A test in this repository** (`apps/server/src/merge/adrNumbers.test.ts`) fails when two files in
  `docs/adr` share a number.
- **The merge queue guards every connected project that keeps ADRs this way.** After it brings a
  branch up to date with the base (and the resolver settled any conflicts), and before the checks
  run again, it looks at `docs/adr` on the branch. If the branch adds a `docs/adr/NNNN-*.md` whose
  number another file already has, the merge fails: the task goes to `needs_you` with a reason that
  names both files and the next free number, e.g. `docs/adr/0033-b.md takes ADR-0033, which
  docs/adr/0033-a.md already has on the base; renumber it to ADR-0036 and update its references`.
- **Only the branch's own ADRs count.** Duplicates among files already on the base do not block
  unrelated merges. Files outside `docs/adr`, nested folders, and other naming styles (e.g.
  `adr-001.md`) are not checked.

## Consequences
- Parallel tasks may still pick the same number; the second one to merge is stopped instead of
  landing silently.
- No agent renumbers automatically. The operator re-runs the task (the reason serves as the
  instruction) or renumbers by hand; the base merged into the branch stays in its worktree, so a
  re-run starts from the updated branch.
- The check is cheap (two git commands) and runs before setup and checks, so a clash fails fast.
