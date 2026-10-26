# ADR-0017: HTTP server — Hono on Node, server-sent events, zod contracts

Status: Accepted · Date: 2026-10-26

## Context
The server exposes a JSON API to the web UI (and later MCP), pushes live updates and binds to
`127.0.0.1` only. It should be small, typed and testable without opening a port.

## Decision
- **Hono** with `@hono/node-server`. Routes are tested in-process with `app.request()`.
- Live updates use **server-sent events** (`GET /api/stream`): the server pushes, the browser only
  reads; commands go through ordinary HTTP requests.
- Request and response shapes are **zod** schemas in `packages/contracts`, shared with the web app.
- Every request's `Host` header must be `127.0.0.1:<port>` or `localhost:<port>`; anything else is
  refused (protection against DNS rebinding, since there is no authentication).
- The server runs TypeScript directly through **tsx** in both dev and stable instances; there is no
  separate server build.

## Consequences
- No WebSocket layer; if two-way streaming is ever needed it gets its own ADR.
- One source of truth for API shapes across server and UI.
