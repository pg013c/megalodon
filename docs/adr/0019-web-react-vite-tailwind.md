# ADR-0019: Web UI — React, Vite, React Router, Tailwind, cmdk

Status: Accepted · Date: 2026-10-26

## Context
The UI must be clean and calm (PRD FR-18): one focus per screen, details in drawers and modals,
`Cmd+K` for everything, light and dark themes.

## Decision
- **React** with **Vite**; **React Router** for the main screens.
- **Tailwind CSS v4** with design tokens (colours, radii, spacing) defined once as CSS variables,
  with a dark variant.
- **cmdk** for the command palette.
- Accessible primitives (dialogs, drawers, menus) from **Radix UI**, added when the first screen needs
  them; no full component kit, so the look stays our own.
- In dev, Vite proxies `/api` to the server; the stable instance serves the built UI from the
  server.

## Consequences
- The visual language is owned by the tokens file, not by a third-party theme.
