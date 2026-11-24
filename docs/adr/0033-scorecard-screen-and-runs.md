# ADR-0033: The scorecard screen and the runs behind it

Status: Accepted · Date: 2026-11-24 · Amended 2026-11-24 (#19) · Builds on ADR-0032

## Context
ADR-0032 counts how each agent and pipeline version did, but `GET /api/scorecard` returns only the
totals. The operator needs to see them next to each other to judge a prompt change, and to open the
runs behind a number to see why it is what it is. The web app had no switch between the active
project and all projects: the Overview always shows all, the Project screen always the active one.

## Decision
- **Agents & Pipelines → Scorecard** (`/library/scorecard`), a second tab next to the library. One
  table for agent versions and one for pipeline versions, grouped by id so every version of an agent
  sits next to the others (current first, then by volume, as the API orders them). Pipelines show
  only what the API counts for them: no success, rework, review or override columns.
- **Reviewer rows** (#19): an agent version with a `reviewer` block (ADR-0032) shows how it judged
  in the Review column instead of the review score it never gets: "Approved x/y", "Score given",
  "Findings b/M/m" (blocker/major/minor) and, when its verdicts were gated, "Sent back". A group with
  two or more versions of which at least one gave verdicts gets a reviewer strip under its version
  rows, with Approved, Approval, Score given, Findings, Per review and Sent back side by side per
  version; a version without verdicts in the period shows —.
- **Period** (24 h, 7 days, 30 days, all; default 30 days, as the API) and **This project / All
  projects** switches above the tables. "This project" is the active project and is the default when
  there is one; without an active project the switch is hidden and the scope is all projects.
- **`GET /api/scorecard/runs?period=&projectId=&agentId=&agentVersion=`** or
  **`…&pipelineId=&pipelineVersion=`** returns `{ total, runs }`: the runs behind one row, newest
  first. Exactly one pair is required (400 otherwise); an unknown project is a 404, as on
  `/api/scorecard`.
  - The list uses the same WHERE clauses as the scorecard's aggregates (shared constants in
    `scorecard/projection.ts`), so `total` always equals the row's `runs`.
  - For an agent, a run is listed when one of that version's steps started in the period, and only
    those steps count in its attempts, rework, review score, cost and duration. For a pipeline, the
    run itself started in the period and its numbers are the run's.
  - At most the latest 100 runs are returned; `total` tells how many there are, and the drawer says
    "Latest 100 of N".
  - Task and project names are joined at read time and are nullable: a disconnected project's row is
    deleted while the scorecard keeps its runs.
- Clicking a row opens a drawer with that list; each run links to its run page. An agent that only
  made decisions outside runs (triage) has nothing to list, and the drawer says so.
- No MCP tool for the run list: `get_scorecard` already gives agents the numbers.

## Consequences
- Versions are ordered current first, then by volume, not by age: the row under the current version
  is not necessarily the version just before it. Ordering by age needs a first-seen time in the
  contract.
- Every run, step, decision and merge event makes the scorecard queries stale while the tab is open.
  They are aggregates over indexed tables, so the refetch is cheap.
