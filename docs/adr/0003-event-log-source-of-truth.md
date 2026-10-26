# ADR-0003: The event log is the source of truth; statuses are projections

Status: Accepted · Date: 2026-10-26

## Context
In the earlier prototype, statuses were stored in several places (task, issue, board column, session) and drifted
apart. Megalodon also has to explain every automatic decision and let the operator override it.

## Decision
Every state change is an immutable event in an append-only SQLite table. Statuses, the dependency
graph, the queue, timelines and metrics are projections updated in the same transaction as the
event. Only commands append events. Projections can be rebuilt from the log.

## Consequences
- One status per item, always consistent with history.
- Timelines, decision logs and evaluation come from the same data.
- Overrides are new events; the past is never rewritten.
- Every new projection needs a rebuild test.
