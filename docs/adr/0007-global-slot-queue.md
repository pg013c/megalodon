# ADR-0007: One global queue with slots, ordered by creation time

Status: Accepted · Date: 2026-10-26

## Context
The earlier prototype's autopilot (settings in several places, sessions, batches) was hard to understand and caused
merge problems. The operator wants a queue, a number of parallel tasks and a view of what runs now.

## Decision
- One global queue across all projects with a global slot limit, protecting the host machine.
- When a slot frees, the oldest `ready` task by creation time starts; tasks that are not ready are
  skipped but keep their place.
- Optional per-project cap; "move to front" is the only manual override.
- No sessions, batches or autopilot modes. A finished task merges and the next one starts.
- Manual tasks, triage and merge queues take no slots.

## Consequences
- The whole behaviour fits in one sentence and one screen.
- Project priorities can be added later if creation order proves insufficient.
