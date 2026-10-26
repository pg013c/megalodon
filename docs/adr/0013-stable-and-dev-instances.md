# ADR-0013: Separate stable and dev instances

Status: Accepted · Date: 2026-10-26

## Context
The MVP goal is that Megalodon develops itself. Its own merges to `main` must not change or restart
the instance whose agents are doing the work.

## Decision
- The stable instance runs a tagged build from the data directory, on port 4600, with data in
  `~/.megalodon`. Upgrading to a new tag is an explicit operator action.
- Dev instances run from a checkout with a throwaway data directory and free ports.
- A lock file prevents two servers from sharing a data directory.
- Agents never start, stop or restart the stable instance.

## Consequences
- Megalodon can be connected to its own repository as a project safely.
