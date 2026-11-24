# ADR-0032: The agent and pipeline scorecard

Status: Accepted · Date: 2026-11-23 · Amended 2026-11-24 (#15), 2026-11-24 (#19) · Builds on ADR-0005, ADR-0029

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
- **Restarts**: an agent attempt that had recorded a session continues that session after a
  Megalodon restart and keeps its attempt number; it is the same attempt. A restart without a
  session (an agent step that had not recorded one yet, or a command or check step) starts the step
  over with the next attempt number. The new attempt replaces the interrupted one, which never
  completed, so the work counts once and keeps the interrupted attempt's rework flag. An attempt
  started over does not raise the run's attempts. A restart is never rework by itself.
- **Attempts that never end**: when a run ends (`run.completed`), its agent attempts still
  `running` are closed as `cancelled`. This covers a run failed on restart (`recover()`), a
  Megalodon error, or a step cut off and never continued. So every attempt in `steps` is succeeded,
  failed or cancelled once its run has finished. Like other cancelled attempts, they stay out of
  the success rate. Migration 11 applies the same rule to rows built before this change.
- **Review score**: the `score` of a `review.verdict` made by an agent belongs to the latest
  succeeded agent attempt in the same run that completed without structured output (no output
  contract, i.e. the implementer). Plan and review steps never receive it. The original verdict
  counts even when the operator later overrides it. A custom pipeline with two contract-less agents
  credits the later one; a review with no such attempt before it credits nobody.
- **Overrides**: decisions made by an agent (`review.verdict`, `triage`) that a later decision
  superseded (`overrides`), whoever made the later one. Policy decisions (`gate`, `merge`, `retry`, `plan`, `queue`) are not agent decisions.
- **Averages per agent version**: `avgCostUsd` and `avgDurationMs` are averaged over the attempts
  that reported their end in a `step.completed` (succeeded, failed or cancelled). Attempts still
  running, or closed only by their run's end, have no cost or duration and are left out. `costUsd`
  is the total over all its attempts.
- **Pipeline run**: attempts = the most attempts any of its steps took; cost = the sum of step costs;
  duration = the sum of step attempt durations, i.e. working time without time parked at a gate or
  queued (as agent time in ADR-0029). `avgAttempts`, `avgCostUsd` and `avgDurationMs` are per
  finished run (succeeded, failed, cancelled).
- **Merged without intervention**: a `merge.completed` names the run and no decision on the run was
  made by the operator (plan approval, gate, verdict or retry override, merging it by hand).
  Share = that count / finished runs. Operator actions that are not decisions (restarting a failed
  task, cleaning the checkout so a merge can go on) do not count as intervention.
- **Reviewer verdicts** (#19): an agent row carries a `reviewer` block when that version made at
  least one `review.verdict` decision in the period. Who is a reviewer comes from the log, not from
  the library's `output: review`, so a removed or older version keeps its numbers. One row per agent
  verdict in `scorecard_reviews` (migration 12), rebuilt with the rest of the scorecard; existing
  installs fill it once on startup when the log has agent verdicts and the table is empty.
  - `verdicts`: the verdicts it gave, including those the operator overrode later. Operator
    verdicts (overrides) never count, for any version.
  - `approved` = verdicts with outcome `approve`; `approvalRate` = approved / verdicts.
  - `avgScore` (score given) = the average `score` of its verdicts, the original ones even when
    overridden; null when no verdict carried a numeric score.
  - `findings` by severity (`blocker`, `major`, `minor`) = the items of the verdict's
    `inputs.findings`; `findingsPerReview` = those totals / verdicts. Findings of an unknown severity,
    or a verdict without a findings list, add nothing.
  - `gated` = verdicts whose step had a `gate` decision; `sentBack` = those whose original gate
    outcome was `fail`. That covers both a request for changes and an approval below the gate's
    `minScore`, whether the run then retried or ran out of fix passes. An operator override of the
    gate does not change it. `sentBackRate` = sentBack / gated; null when no verdict was gated (a
    reviewer in a pipeline without a gate shows —, not 0%). Because an approval below `minScore` is
    sent back, approval rate and sent-back share are not complements.
- **Period**: a step or run counts in the period it started, a decision (and a verdict) in the
  period it was made.
- **Single-agent runs** are pipeline `agent:<id>`; their current version is the agent's. Runs from
  before pipelines existed (`unknown` version) are never current.

## Consequences
- A gate is tied to its verdict by being appended right after it, for the same run and step (both
  in `RunService.judge` today). Reordering them, or a gate on a step without a verdict, would leave a
  verdict ungated or tie the gate to the wrong verdict.
- Rework relies on the retry decision being recorded before the step it sends the run back to
  starts (both happen in the run loop today); changing that order would silently zero rework.
- The library re-reads agents for every step, so one run can count for two versions of the same
  agent; runs per version need not add up to all runs.
- A run that succeeded but still waits in the merge queue lowers the unattended share until it
  merges.
- Costs are the SDK's estimates (ADR-0029), not a bill.
- The cost of an attempt cut off without a `step.completed` is unknown and counts as 0 in totals.
- `overridden` counts any decision that supersedes an agent decision. Today only the operator's
  override (`DecisionService.override`) sets `overrides`; if a system or agent re-decision ever does,
  it would count as an override too, because the projection does not check who superseded it.
