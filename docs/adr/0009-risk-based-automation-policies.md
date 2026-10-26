# ADR-0009: Automation by default, gated by per-project risk-based policies

Status: Accepted · Date: 2026-10-26

## Context
Manual starts, approvals, merges and rebases make the operator the bottleneck. Several projects can
only progress at once if most of the flow is automatic.

## Decision
- Every gate (queue after triage, plan approval, merge, conflict resolution, push) has a per-project
  policy: `auto`, `auto-if` with conditions, or `operator`.
- Conditions are risk based: check results, review score, sensitive paths in the touch-set.
- All policies live in one settings section of the project; nothing is configured per task.
- The flow ends at `main`; release to production is out of scope for now.

## Consequences
- Each automatic gate decision is recorded with the condition values that decided it.
