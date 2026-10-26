# Megalodon

Local multi-project agent orchestrator, written from scratch (ADR-0001).

## Read first
- `docs/PRD.md` — what the product is.
- `docs/CONCEPTS.md` — vocabulary, statuses, dependencies, queue rules. Code must match it.
- `docs/ARCHITECTURE.md` — how it is built; open questions in §14.
- `docs/MVP.md` — steps and criteria; the current step is the first with unchecked criteria.
- `docs/adr/` — decisions. Add a new ADR (next free number) for every non-trivial decision; never
  rewrite an accepted one, supersede it.

## Rules
- Docs and code in English. The operator (Przemo) talks in Polish.
- Never copy code or files from the earlier prototype or its plugins; take ideas only.
- No dependencies on Claude Code plugins.
- Agents never write to a connected project's main checkout; they work only in worktrees. The only
  write there is the server's guarded merge (ADR-0014).
- Never push or open pull requests without an explicit operator action.

## Running
- Verify changes with `pnpm typecheck` and `pnpm test`.
- The stable instance (port 4600, data `~/.megalodon`) may be orchestrating you. Never start a
  server on that port or data directory, and never stop the process that holds it.
- To run the app, use a throwaway data directory and free ports, e.g.
  `MEGALODON_DATA_DIR=$(mktemp -d) MEGALODON_PORT=4697 MEGALODON_SERVE_WEB=1 pnpm --filter @megalodon/server start`.
- Never run `pnpm stable` or `pnpm release`, and never create tags: those belong to the operator.
