# ADR-0024: Claude runtime settings, run plan, worktrees and recovery

Status: Accepted · Date: 2026-10-26

## Context
MVP step 3 runs a single agent on a task in its own worktree. It fixes how an agent definition
becomes a Claude Agent SDK session, what a run is made of, and what happens when Megalodon stops
in the middle of one.

## Decision
- **Claude runtime** (`@anthropic-ai/claude-agent-sdk`, the operator's local Claude login):
  - `tools` and `allowedTools` are exactly the agent's tools; `permissionMode: 'dontAsk'` refuses
    everything else without asking. MCP servers come only from the agent file.
  - `settingSources: ['project']`: the project's own `CLAUDE.md` and `.claude/settings.json` load;
    the operator's user settings, plugins and hooks never do (ADR-0001).
  - System prompt: the Claude Code preset with the agent's instructions appended.
  - The environment is the server's minus integration credentials and `MEGALODON_*` (ADR-0010).
  - Transcripts are stored with tool inputs clipped at 4 000 and tool results at 2 000
    characters; full results stay in the SDK's own session files.
- **Agent files** (ADR-0005) use the tool names of the Claude runtime (`Read`, `Edit`, `Bash`, …)
  and `mcp__<server>` for all tools of a server the file configures. The version is the first 12
  hex characters of the file's SHA-256.
- **A run** has a plan fixed in `run.started`: an optional `setup` command step (the project's
  setup commands) and one agent step. Events: `run.started`, `step.started`, `step.session`,
  `step.message`, `step.completed` (with usage), `run.completed`, `run.resumed`, all in the stream
  `run:<id>`. Run totals are the sum of completed steps.
- **Worktree and branch:** `<data dir>/worktrees/<project>/<run>`, branch `megalodon/<n>-<slug>`
  (suffixed `-2`, `-3` when taken), from the base branch's current commit. `git worktree add` writes
  only to the repository's git directory, never to the operator's working tree. When the agent
  finishes, Megalodon commits everything with the operator's git identity: `#<n> <title>` and the
  agent's summary. Agents never commit themselves.
- **Task status** until the scheduler exists: the operator starts a run from `backlog`, `ready`,
  `failed` or `needs_you`; the task goes `running`. Success → `needs_you` ("Review <branch>");
  failure → `failed`; a stop by the operator → `failed` ("Stopped by you"); cancelling the task
  stops its run.
- **Recovery:** on shutdown, executing runs are aborted without an outcome. On startup a run still
  `running` resumes: a completed step is skipped, an agent step with a session continues that
  session (`resume`), anything else restarts the step. A run whose worktree is gone fails with the
  reason.
- **Tests** use a scripted runtime; no test calls a model.

## Consequences
- Bash allowed to an agent can still reach the network and the file system outside the worktree;
  OS-level sandboxing is a later decision.
- Port and database isolation per run (ARCHITECTURE §8) arrive with the scheduler, when runs of
  one project overlap.
