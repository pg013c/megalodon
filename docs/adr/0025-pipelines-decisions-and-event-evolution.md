# ADR-0025: Pipeline execution, output contracts, decisions and evolving event schemas

Status: Accepted · Date: 2026-10-26

## Context
MVP step 4 turns a run into a pipeline of agents and checks (ADR-0005) and records every choice
along the way as a decision the operator can override (CONCEPTS.md §7).

## Decision
- **Pipeline file** (`library/pipelines/<id>.yaml`): `name`, `description`, `steps`. A step is
  `{ id, agent, gate?, onFail? }` or `{ id, check: project, onFail? }`. `gate: { minScore }` applies
  to an agent with the `review` output; `onFail: { retry: <earlier step>, max: <n> | project }`,
  where `project` means the project's fix passes. The built-in `feature` pipeline is
  plan → implement → checks (retry implement, project fix passes) → review (gate 7, retry
  implement once).
- **Plan fixed at start:** the run's plan copies the project's setup commands and checks and
  resolves `max: project`, so a later settings change never alters a running run. A single-agent
  run is the pipeline `agent:<id>`.
- **Output contracts:** an agent may declare `output: plan | review`. The Claude runtime passes the
  contract as a JSON schema (`outputFormat`), and Megalodon validates the answer with the same zod
  schema; an invalid answer fails the step. Outputs flow forward: the plan goes into the
  implementer's and reviewer's prompts; the reviewer also gets the diff (clipped at 60 000
  characters) and the check report.
- **Checks** run by Megalodon in the worktree; required ones decide. A failed check or a failed
  gate is a *rejection*: the step's `onFail` either sends the run back (a `retry` decision whose
  inputs carry the feedback) or stops it. A retried agent continues its previous session with the
  feedback. Every agent step's changes are committed after it, so checks and the reviewer see a
  commit.
- **Endings:** an error (setup, agent failure, invalid output) fails the task; a rejection after
  the last retry ends the run `failed` but puts the task in `needs_you`, since there is a branch to
  look at; success puts the task in `needs_you` with the gate's rationale.
- **Decisions** are `decision.made` events: `kind`, `outcome`, `rationale`, `alternatives`,
  `inputs`, actor. Run decisions go to `run:<id>`, others to `task:<id>`. Kinds today:
  `review.verdict` (agent), `gate` and `retry` (policy `pipeline:<id>`). An override is a new
  decision by the operator with `overrides: <id>`, restricted to the alternatives; the projection
  marks the old one `supersededBy`. What an override changes beyond the record arrives with the
  steps that act on it (the merge queue reads the effective `gate`).
- **Atomic step endings:** a step's completion and the decisions it causes are appended in one
  transaction, so replaying a run's events (`runPosition`) always knows the next step — also after
  a restart.
- **Evolving events:** event schemas change only by adding fields with defaults or by an upcast in
  the schema (`z.preprocess`); stored events are never rewritten. Step-3 runs (`agentId`, no
  `pipelineId`, no attempts) read as `agent:<id>` with attempt 1. Migration 5 moves existing rows
  the same way.

## Consequences
- A pipeline is visible as data: its steps, gates and retries show in the library and in every run.
- Overrides are recorded now but have no effect until the merge queue (step 6) reads them.
