# ADR-0006: Dependencies are planned at triage and revalidated before start

Status: Accepted · Date: 2026-10-26

## Context
Work must not discover halfway through that it needs something unfinished. The board must show
what each item needs before it can start, including work only a human can do.

## Decision
- Every new task is triaged by an agent that proposes dependencies, a touch-set, a pipeline and
  manual tasks. Each result is a decision the operator can override.
- Dependency kinds: `code`, `collision`, `manual`, `external` (`CONCEPTS.md` §4). A dependency may
  target a story, meaning all its tasks.
- Right before a task takes a slot, its dependencies and touch-set are revalidated against `main`;
  a failed revalidation returns it to `blocked` with the reason.

## Consequences
- Triage is the most important agent; its quality is measured first.
- Manual work appears on the board as nodes that block code.
