# ADR-0030: Megalodon over MCP, and the chat built on it

Status: Accepted · Date: 2026-10-26

## Context
MVP step 9 asks for every command and query to be reachable over MCP, and for a chat inside
Megalodon that can act on it, so the operator never needs a separate Claude window (PRD FR-17).

## Decision
- **MCP endpoint** `/mcp` on the server, streamable HTTP, stateless: each request gets a fresh MCP
  server over the same services the HTTP API uses (`@modelcontextprotocol/sdk`, web-standard
  transport). The Host check and loopback binding protect it like the rest of the API.
- **Tools** (38 today): every query (projects, workspace, project work, task, runs, run with the
  last timeline entries, Needs you, queue, overview, agents, pipelines, branches, diffs) and every
  command (connect, active project, settings patch, stories, tasks, manual tasks, triage, queue,
  retry, front, dependencies, touch-sets, pipelines, start and stop runs, decision overrides,
  merge, queue slots, pause, resume). Tasks are referenced by id or `#number` in the given or the
  active project. MCP callers act **as the operator** — it is the operator's tool — so tasks they
  create are triaged like tasks typed in the UI. Failures are MCP tool errors with the API's
  message.
- **Chat:** the `chat` agent (library) with read-only code tools plus `mcp__megalodon`, pointed at
  the server's own `/mcp`; it works in the active project's checkout. Every message starts with a
  context line: today's date, the active project and the open task or run (taken from the UI's
  address). One conversation at a time continues one agent session (`resume`); **New chat**
  starts another. Messages are events in `chat:<id>` (`chat.started`, `message`, `session`,
  `finished`), so the conversation streams live and survives restarts; a conversation a restart
  left busy is closed with a note.
- The chat panel sits beside every screen (Assistant button, `Cmd+J`).

## Consequences
- Claude Code, Claude Desktop or any MCP client can drive the stable instance at
  `http://127.0.0.1:4600/mcp`.
- The chat's spend is not in the Overview yet (it belongs to no project).
