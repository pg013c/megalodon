# ADR-0032: The agent and pipeline scorecard

Status: Accepted · Date: 2026-11-23 · Builds on ADR-0005, ADR-0029

## Context
Every run records the pipeline version it followed and every agent step the agent version it used
(the content hash of the definition, ADR-0005). PRD FR-13 asks to compare versions: does a new
implementer prompt pass checks more often, does a pipeline merge without the operator. Nothing
aggregated these versions yet, and "success" and "rework" need one meaning before they are counted.

## Decision
- **Scorecard projection** (`scorecard_runs`, `scorecard_steps`, `scorecard_decisions`,
  migration 10), built from run, step, decision and merge events. It reads only its own tables and
  the task's project (`tasks.project_id`, which never changes), so it can be rebuilt by itself
  (`EventStore.rebuild(['scorecard'])`). Existing installs fill it once from the log on startup.
- **`GET /api/scorecard?projectId=&period=24h|7d|30d|all`** (default 30 days) and the MCP tool
  `get_scorecard` return one row per agent version and one per pipeline version. Versions with no
  steps, runs or decisions in the period are not listed. `current` marks the version in the library
  now; `name` is null when the id is no longer in the library.
- **Agent step**: one attempt of an agent step. Command and check steps are not scored.
- **Success rate** = attempts that `succeeded` / attempts that ended `succeeded` or `failed`.
  Cancelled attempts (stopped by the operator, task cancelled) and running ones are left out; null
  when none ended. A reviewer that asks for changes still succeeded its step: quality shows in rework
  and the review score, not in success.
- **Rework**: an agent attempt started because a `retry` decision (`retry <step>`) sent the run
  back to that step (`inputs.next`), after failed checks or a failed review gate. It counts against
  the version that ran the retried step (the implementer in `feature`). Running the reviewer again
  afterwards is not rework.
- **Restarts**: an attempt that continues its agent session after a Megalodon restart is the same
  attempt. An attempt that was cut off and started over gets the next attempt number; it replaces
  the interrupted one (which never completed), so the work counts once, keeps the interrupted
  attempt's rework flag, and does not raise the run's attempts. A restart is never rework by itself.
- **Review score**: the `score` of a `review.verdict` made by an agent belongs to the latest
  succeeded agent attempt in the same run that completed without structured output (no output
  contract, i.e. the implementer). Plan and review steps never receive it. The original verdict
  counts even when the operator later overrides it. A custom pipeline with two contract-less agents
  credits the later one; a review with no such attempt before it credits nobody.
- **Overrides**: decisions made by an agent (`review.verdict`, `triage`) that a later decision
  superseded (`overrides`), whoever made the later one. Policy decisions (`gate`, `merge`, `retry`, `plan`, `queue`) are not agent decisions.
- **Averages per agent version**: cost and duration per attempt that ended (succeeded, failed or
  cancelled); `costUsd` is the total over all its attempts.
- **Pipeline run**: attempts = the most attempts any of its steps took; cost = the sum of step costs;
  duration = the sum of step attempt durations, i.e. working time without time parked at a gate or
  queued (as agent time in ADR-0029). Averages are over finished runs (succeeded, failed,
  cancelled).
- **Merged without intervention**: a `merge.completed` names the run and no decision on the run was
  made by the operator (plan approval, gate, verdict or retry override, merging it by hand).
  Share = that count / finished runs. Operator actions that are not decisions (restarting a failed
  task, cleaning the checkout so a merge can go on) do not count as intervention.
- **Period**: a step or run counts in the period it started, a decision in the period it was made.
- **Single-agent runs** are pipeline `agent:<id>`; their current version is the agent's. Runs from
  before pipelines existed (`unknown` version) are never current.

## Consequences
- Rework relies on the retry decision being recorded before the step it sends the run back to
  starts (both happen in the run loop today); changing that order would silently zero rework.
- The library re-reads agents for every step, so one run can count for two versions of the same
  agent; runs per version need not add up to all runs.
- A run that succeeded but still waits in the merge queue lowers the unattended share until it
  merges.
- Costs are the SDK's estimates (ADR-0029), not a bill.
- `overridden` counts any decision that supersedes an agent decision. Today only the operator's
  override (`DecisionService.override`) sets `overrides`; if a system or agent re-decision ever does,
  it would count as an override too, because the projection does not check who superseded it.
