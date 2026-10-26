# ADR-0002: Stack — TypeScript, Node, SQLite, Claude Agent SDK, local web app

Status: Accepted · Date: 2026-10-26

## Context
Megalodon is a single-operator tool running on the operator's Mac, driving agents on the
operator's Claude subscription.

## Decision
- TypeScript everywhere, Node server, pnpm workspace.
- SQLite as the only database.
- Claude Agent SDK as the agent runtime.
- A local web app bound to `127.0.0.1`, without authentication.

## Consequences
- One language for server, UI and contracts.
- No database server to run; backups are file copies.
- Further libraries are chosen in MVP step 0 and recorded as ADRs.
