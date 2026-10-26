# ADR-0004: Two-level work model — Story and Task

Status: Accepted · Date: 2026-10-26

## Context
The earlier prototype's Epic → Story → Task hierarchy was too complex for daily use.

## Decision
- Two levels: **Story** (user-visible value) and **Task** (unit an agent pipeline finishes and
  merges). A task may stand alone, without a story.
- **Manual tasks** are a separate kind of task, done by the operator.
- A story's status is derived from its tasks and never set directly.
- The status model is defined in `CONCEPTS.md` §3.

## Consequences
- Simple board; small fixes need no parent.
- Large initiatives are expressed as several stories with dependencies, not a third level.
