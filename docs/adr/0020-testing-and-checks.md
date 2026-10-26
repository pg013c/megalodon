# ADR-0020: Vitest everywhere; `pnpm typecheck` and `pnpm test` are the checks

Status: Accepted · Date: 2026-10-26

## Context
Every MVP step ends with the same checks, and later Megalodon will run them on itself as project
checks (ADR-0015).

## Decision
- **Vitest** in every package; tests sit next to the code as `*.test.ts(x)`.
- `pnpm typecheck` runs `tsc --noEmit` in every package; `pnpm test` runs every package's tests.
- Server tests use a real SQLite database in a temporary directory, never mocks of the store.
- Every projection has a rebuild test (ADR-0003).

## Consequences
- The same two commands are the project checks when Megalodon connects to its own repository.
