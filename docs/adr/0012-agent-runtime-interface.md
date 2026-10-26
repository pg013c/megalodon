# ADR-0012: A narrow agent runtime interface; Claude only

Status: Accepted · Date: 2026-10-26

## Context
Other agent SDKs (OpenAI, Gemini/Antigravity, Grok) may be added later, but they differ in tools,
MCP support and permissions.

## Decision
Agents run behind a narrow `AgentRuntime` interface: run an agent definition in a working directory
with a prompt, stream events, return the final artifact. Only the Claude Agent SDK implementation
is built, using the operator's subscription.

## Consequences
- No speculative abstraction over provider-specific features.
- Adding a provider means implementing one interface and mapping its tools.
