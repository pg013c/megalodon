# ADR-0016: Project knowledge base as files committed to the project

Status: Accepted · Date: 2026-10-26

## Context
Agents need each project's own business decisions so that the same feature in two projects never
mixes context, and the operator wants to read the PRD, ADRs and other artifacts at any time.

## Decision
- The knowledge base is a folder of files in the project repository, by default `docs/`
  (`PRD.md`, `adr/` and other artifacts); the path is a project setting, so existing layouts are
  reused.
- Agents read it as context and update it in their worktree; changes reach `main` through the
  normal merge flow, with history and review like code.
- Per project, the knowledge base can instead live **outside the repository**, in a git repository
  under Megalodon's data directory, for projects (e.g. clients') that should not receive such files.

## Consequences
- The operator browses a project's knowledge base in Megalodon or in the repository itself.
- Closes `ARCHITECTURE.md` open question 3.
