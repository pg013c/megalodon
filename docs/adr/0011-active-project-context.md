# ADR-0011: Active project as the working context; `main` as the base

Status: Accepted · Date: 2026-10-26

## Context
The same feature (e.g. payments) exists in several projects with different business rules.
Searching and working across all projects at once is slow for the machine and confusing for the
operator.

## Decision
- The UI has one active project; search and chat default to it, with a switch for global search.
- `main` is always the base branch for tasks and merges.
- Any branch can be browsed with its diff against `main`, and agents or pipelines can run on a
  chosen branch. There is no global "active branch" switch.
- The global Overview shows all projects without switching the active one.

## Consequences
- Every query and agent prompt is scoped to a project unless stated otherwise.
