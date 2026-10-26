# ADR-0005: Agent-based pipelines defined as versioned files

Status: Accepted · Date: 2026-10-26

## Context
Agents carry the value: persona, tools, permissions. The operator wants to build, see and evaluate
pipelines inside Megalodon, without plugins.

## Decision
- An **agent** is a Markdown file with front matter: model, tools, permissions, output contract,
  and the persona/instructions as body.
- A **pipeline** is a YAML graph of agent steps and deterministic checks, with retry and gate rules.
- Built-in defaults live in the repository; the operator's definitions live in a git-versioned
  library in the data directory. The UI edits these files.
- Every run records the content hash of each agent and pipeline it used.

## Consequences
- Every step has a typed output, which makes evaluation possible.
- Definitions can be diffed, reviewed and rolled back like code.
