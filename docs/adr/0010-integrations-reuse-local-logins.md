# ADR-0010: Integrations reuse the operator's local logins; agents never inherit them

Status: Accepted · Date: 2026-10-26

## Context
Megalodon runs locally for one operator who is already logged in to `git`, `gh` and AWS (SSO
profiles). Managing a second set of secrets adds work and risk.

## Decision
- Integrations use existing local sessions: git credentials, the `gh` CLI, AWS named profiles.
- Where no usable CLI session exists (e.g. Bitbucket), a token is stored in the macOS Keychain.
- Expired sessions show as "log in again"; Megalodon never stores passwords.
- Agents do not inherit these credentials. An agent's access comes only from its definition.

## Consequences
- No secret management in Megalodon for the common cases.
- Production access used by Megalodon (e.g. reading AWS logs) is never available to agents by
  accident.
