import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { outputContracts, zeroUsage, type Usage } from '@megalodon/contracts';
import { z } from 'zod';
import { clip, type AgentRunInput, type AgentRuntime, type RuntimeEvent } from './types';

const TOOL_INPUT_LIMIT = 4_000;
const TOOL_RESULT_LIMIT = 2_000;

/** Claude Agent SDK on the operator's local Claude login (subscription). */
export class ClaudeRuntime implements AgentRuntime {
  async *run(input: AgentRunInput): AsyncIterable<RuntimeEvent> {
    const abortController = new AbortController();
    if (input.signal.aborted) abortController.abort();
    else input.signal.addEventListener('abort', () => abortController.abort(), { once: true });
    const started = Date.now();
    let sawResult = false;
    try {
      for await (const message of query({ prompt: input.prompt, options: claudeOptions(input, abortController) })) {
        for (const event of mapSdkMessage(message)) {
          if (event.type === 'result') sawResult = true;
          yield event;
        }
      }
    } catch (error) {
      if (sawResult) return;
      yield failure(input.signal.aborted ? 'Stopped' : errorMessage(error), Date.now() - started);
      return;
    }
    if (!sawResult) yield failure('The agent ended without a result', Date.now() - started);
  }
}

/**
 * The agent gets only the tools its definition names, and anything else is refused without a
 * prompt (`dontAsk`). Only project settings load (its CLAUDE.md), never the operator's user
 * settings, plugins or hooks (ADR-0001, ADR-0024).
 */
export function claudeOptions(input: AgentRunInput, abortController: AbortController): Options {
  const { agent } = input;
  const builtins = agent.tools.filter((t) => !t.startsWith('mcp__'));
  return {
    cwd: input.cwd,
    model: agent.model,
    ...(agent.effort ? { effort: agent.effort } : {}),
    tools: builtins,
    allowedTools: agent.tools,
    permissionMode: 'dontAsk',
    mcpServers: agent.mcpServers,
    settingSources: ['project'],
    systemPrompt: { type: 'preset', preset: 'claude_code', append: agent.instructions },
    env: input.env,
    abortController,
    ...(agent.maxTurns ? { maxTurns: agent.maxTurns } : {}),
    ...(agent.maxBudgetUsd ? { maxBudgetUsd: agent.maxBudgetUsd } : {}),
    ...(input.resumeSessionId ? { resume: input.resumeSessionId } : {}),
    ...(agent.output ? { outputFormat: { type: 'json_schema', schema: jsonSchema(agent.output) } } : {}),
  };
}

/**
 * The output contract as JSON Schema for Claude Code's `--json-schema`, whose validator does not
 * know the draft 2020-12 meta-schema zod points to; draft 7 without `$schema` validates the same.
 */
export function jsonSchema(contract: keyof typeof outputContracts): Record<string, unknown> {
  const { $schema: _ignored, ...schema } = z.toJSONSchema(outputContracts[contract], { target: 'draft-7' }) as Record<string, unknown>;
  return schema;
}

/** Translates one SDK message into runtime events; everything else the SDK emits is ignored. */
export function mapSdkMessage(message: SDKMessage): RuntimeEvent[] {
  switch (message.type) {
    case 'system':
      return message.subtype === 'init' ? [{ type: 'session', sessionId: message.session_id }] : [];
    case 'assistant': {
      if (message.parent_tool_use_id !== null) return []; // subagent chatter
      const events: RuntimeEvent[] = [];
      for (const block of message.message.content) {
        if (block.type === 'text' && block.text.trim()) events.push({ type: 'message', message: { kind: 'text', text: block.text } });
        if (block.type === 'tool_use') {
          events.push({
            type: 'message',
            message: { kind: 'tool_use', toolUseId: block.id, name: block.name, input: clip(JSON.stringify(block.input), TOOL_INPUT_LIMIT) },
          });
        }
      }
      if (message.error) events.push({ type: 'message', message: { kind: 'text', text: `API error: ${message.error}` } });
      return events;
    }
    case 'user': {
      if (message.parent_tool_use_id !== null || typeof message.message.content === 'string') return [];
      return message.message.content.flatMap((block): RuntimeEvent[] =>
        block.type === 'tool_result'
          ? [
              {
                type: 'message',
                message: {
                  kind: 'tool_result',
                  toolUseId: block.tool_use_id,
                  isError: block.is_error === true,
                  content: clip(toolResultText(block.content), TOOL_RESULT_LIMIT),
                },
              },
            ]
          : [],
      );
    }
    case 'result': {
      const usage = usageOf(message.modelUsage, message.total_cost_usd);
      const ok = message.subtype === 'success' && !message.is_error;
      return [
        {
          type: 'result',
          ok,
          result: message.subtype === 'success' ? message.result : null,
          ...(message.subtype === 'success' && message.structured_output !== undefined ? { output: message.structured_output } : {}),
          error: ok ? null : message.subtype === 'success' ? message.result : `${message.subtype}: ${message.errors.join('; ')}`,
          usage,
          durationMs: message.duration_ms,
          numTurns: message.num_turns,
        },
      ];
    }
    default:
      return [];
  }
}

function usageOf(
  modelUsage: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number }>,
  costUsd: number,
): Usage {
  const usage = { ...zeroUsage, costUsd };
  for (const m of Object.values(modelUsage)) {
    usage.inputTokens += m.inputTokens;
    usage.outputTokens += m.outputTokens;
    usage.cacheReadTokens += m.cacheReadInputTokens;
    usage.cacheWriteTokens += m.cacheCreationInputTokens;
  }
  return usage;
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part: { type?: string; text?: string }) => (part.type === 'text' ? (part.text ?? '') : `[${part.type}]`)).join('\n');
  }
  return '';
}

function failure(error: string, durationMs: number): RuntimeEvent {
  return { type: 'result', ok: false, result: null, error, usage: zeroUsage, durationMs, numTurns: null };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
