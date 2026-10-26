# ADR-0022: Web data layer — TanStack Query kept fresh by the event stream

Status: Accepted · Date: 2026-10-26

## Context
The UI reads server state (projects, branches, later tasks and runs) and must show changes made
elsewhere — by agents, the scheduler or another tab — without manual refreshes.

## Decision
- Server state in the UI lives in **TanStack Query**; responses are validated against the zod
  contracts before they reach a component.
- The UI opens one `EventSource` on `/api/stream`. Each event type maps to the query keys it makes
  stale (`staleKeys`), and those queries refetch. Events are notifications; the API stays the only
  way to read state.
- The stream starts at the current end of the log; a reconnecting `EventSource` sends
  `Last-Event-ID` and receives what it missed.
- App-wide UI state (e.g. the Connect dialog opened from several places) is a small React context,
  not a global store.

## Consequences
- Adding a projection means adding its query keys to `staleKeys`.
- No client-side event replay logic; the server's projections stay the only read model.
