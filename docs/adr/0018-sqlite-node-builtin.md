# ADR-0018: SQLite through Node's built-in `node:sqlite`, plain SQL, numbered migrations

Status: Accepted · Date: 2026-10-26

## Context
SQLite is the only database (ADR-0002). The event store needs synchronous transactions that wrap
an append and its projection updates. Native addons (`better-sqlite3`) need a compile step and
build-script approval in pnpm.

## Decision
- Use Node's built-in **`node:sqlite`** (`DatabaseSync`): synchronous, no native dependency.
- It is still marked experimental in Node 22, so all access goes through one thin module
  (`apps/server/src/db`); its experimental warning is silenced at startup. Swapping to
  `better-sqlite3` would touch only that module.
- **Plain SQL**, no ORM: the event store and projections are simple tables, and SQL keeps
  projections explicit.
- Schema changes are **numbered migrations** in code, applied in order at startup and recorded in a
  `migrations` table. WAL mode and foreign keys are on.

## Consequences
- Zero native builds; the repository installs anywhere Node 22+ runs.
- A Node upgrade that changes the experimental API is contained in one module.
