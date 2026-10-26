# ADR-0001: Megalodon is a clean-room successor of an earlier internal prototype

Status: Accepted · Date: 2026-10-26

## Context
An earlier internal prototype proved the idea of a local multi-agent control panel, but its code
is not Megalodon's to reuse, and it depends on an external plugin for its pipelines. It also grew
quickly and accumulated complex flows (autopilot sessions, multi-level issues) that were hard to use.

## Decision
Megalodon is a new project written from scratch. It takes **ideas and lessons** from
the earlier prototype, never code, files or its plugins. Agents and pipelines are Megalodon's own definitions;
there is no dependency on external plugins.

## Consequences
- No legal or technical ties to the earlier prototype or its plugins.
- Proven concepts (worktree per run, gates, touch-sets, manual tasks, merge queue) must be
  re-specified in these docs before they are built.
