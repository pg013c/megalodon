# Megalodon

A private, local command centre for one operator who leads many software projects through AI
agents: dependency-aware task queue, agent-based pipelines in isolated worktrees, automatic merges
gated by policy, a full decision log, and one calm interface for all of it.

Status: MVP step 9 (steps 0–8 are done). Start with [`docs/PRD.md`](docs/PRD.md), then [`docs/CONCEPTS.md`](docs/CONCEPTS.md),
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/MVP.md`](docs/MVP.md). Decisions are in
[`docs/adr/`](docs/adr/).

## Running

Requires Node 22.13+ and pnpm 11.

```bash
pnpm install
pnpm dev                 # dev instance from this checkout: server 4610, UI http://127.0.0.1:5610, data ~/.megalodon-dev
pnpm start               # this checkout built, served on 4610 with the dev data
git tag v0.1.0 && pnpm release v0.1.0   # build a release into ~/.megalodon/releases/v0.1.0
pnpm stable              # the stable instance: current release, http://127.0.0.1:4600, data ~/.megalodon
pnpm typecheck
pnpm test
```

Merges Megalodon makes into its own `main` never touch the stable instance; upgrade it with a
new tag and `pnpm release` (ADR-0013). Other clients can use Megalodon over MCP at
`http://127.0.0.1:4600/mcp` (ADR-0030).

Environment: `MEGALODON_PORT`, `MEGALODON_WEB_PORT` (dev UI), `MEGALODON_DATA_DIR`,
`MEGALODON_SERVE_WEB=1` (serve the built UI from the server).
