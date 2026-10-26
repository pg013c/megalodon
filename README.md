# Megalodon

A private, local command centre for one operator who leads many software projects through AI
agents: dependency-aware task queue, agent-based pipelines in isolated worktrees, automatic merges
gated by policy, a full decision log, and one calm interface for all of it.

Status: MVP step 4 (steps 0–3 are done). Start with [`docs/PRD.md`](docs/PRD.md), then [`docs/CONCEPTS.md`](docs/CONCEPTS.md),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/MVP.md`](docs/MVP.md). Decisions are in
[`docs/adr/`](docs/adr/).

## Running

Requires Node 22.13+ and pnpm 11.

```bash
pnpm install
pnpm dev        # dev instance: server on 4610, UI on http://127.0.0.1:5610, data in ~/.megalodon-dev
pnpm start      # stable instance: http://127.0.0.1:4600, data in ~/.megalodon
pnpm typecheck
pnpm test
```

Environment: `MEGALODON_PORT`, `MEGALODON_WEB_PORT` (dev UI), `MEGALODON_DATA_DIR`,
`MEGALODON_SERVE_WEB=1` (serve the built UI from the server).
