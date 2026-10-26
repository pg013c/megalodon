# ADR-0029: The Overview and how agent spend is counted

Status: Accepted · Date: 2026-10-26

## Context
MVP step 8 gives the supervisor one screen: what needs them, the queue, and every project's
progress, live work and spend over a chosen period (PRD FR-2).

## Decision
- **Agent usage projection** (`agent_usage`, migration 8): one row per agent call with the project,
  kind (`run` for an agent step, `triage`, `resolver`), cost and duration, at the event's time.
  Triage and conflict resolution now record their spend in `triage.completed` / `triage.failed`
  and `merge.resolved`. Command steps (setup, checks) are not agent spend.
- **Agent time** is the sum of agent call durations, not wall-clock time: three agents working in
  parallel for ten minutes count thirty minutes.
- **`GET /api/overview?period=24h|7d|30d|all`** (default 7 days) returns: the Needs you total and
  counts per kind, and per project — task counts per status, progress (done of all but cancelled),
  live work (running tasks with their current step and attempt, merging tasks), the Needs you count,
  spend and agent time in the period, tasks merged in the period, and a blocked checkout. Projects
  with work or waiting items come first. Everything is derived from projections at read time.
- The Overview shows, top to bottom: totals for the period, a Needs you strip linking to the
  Needs you screen, the queue panel, and a card per project.

## Consequences
- Spend recorded before this step (triage, resolver) is not in the totals; run steps are, because
  the projection rebuilds from the log.
- Costs are the estimates the Claude Agent SDK reports, not a bill.
