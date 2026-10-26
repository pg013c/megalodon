import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Agent } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { claudeOptions, mapSdkMessage } from './claude';

// SDK messages carry many more fields; the mapping reads only these.
const sdk = (message: object) => message as unknown as SDKMessage;

const agent: Agent = {
  id: 'implementer',
  name: 'Implementer',
  description: '',
  model: 'claude-opus-5-5',
  effort: 'high',
  tools: ['Read', 'Edit', 'mcp__docs'],
  mcpServers: { docs: { type: 'http', url: 'https://example.com/mcp' } },
  maxTurns: 50,
  instructions: 'Be careful.',
  source: 'builtin',
  version: 'abc',
};

describe('claudeOptions', () => {
  it('gives the agent only its own tools, refuses the rest, and loads only project settings', () => {
    const options = claudeOptions(
      { agent, cwd: '/wt', prompt: 'x', env: { PATH: '/bin' }, signal: new AbortController().signal },
      new AbortController(),
    );
    expect(options).toMatchObject({
      cwd: '/wt',
      model: 'claude-opus-5-5',
      effort: 'high',
      tools: ['Read', 'Edit'],
      allowedTools: ['Read', 'Edit', 'mcp__docs'],
      permissionMode: 'dontAsk',
      settingSources: ['project'],
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'Be careful.' },
      env: { PATH: '/bin' },
      maxTurns: 50,
    });
    expect(options.resume).toBeUndefined();
  });

  it('resumes a session when asked', () => {
    const options = claudeOptions(
      { agent, cwd: '/wt', prompt: 'x', env: {}, resumeSessionId: 's1', signal: new AbortController().signal },
      new AbortController(),
    );
    expect(options.resume).toBe('s1');
  });
});

describe('mapSdkMessage', () => {
  it('reads the session id from init', () => {
    expect(mapSdkMessage(sdk({ type: 'system', subtype: 'init', session_id: 's1' }))).toEqual([{ type: 'session', sessionId: 's1' }]);
  });

  it('turns assistant text and tool calls into messages, skipping subagents', () => {
    const message = sdk({
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'thinking', thinking: '' },
          { type: 'text', text: 'Looking at the code.' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.ts' } },
        ],
      },
    });
    expect(mapSdkMessage(message)).toEqual([
      { type: 'message', message: { kind: 'text', text: 'Looking at the code.' } },
      { type: 'message', message: { kind: 'tool_use', toolUseId: 't1', name: 'Read', input: '{"file_path":"a.ts"}' } },
    ]);
    expect(mapSdkMessage(sdk({ type: 'assistant', parent_tool_use_id: 'x', message: { content: [{ type: 'text', text: 'hi' }] } }))).toEqual([]);
  });

  it('clips long tool results', () => {
    const message = sdk({
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(5000), is_error: false }] },
    });
    const [event] = mapSdkMessage(message);
    expect(event).toMatchObject({ type: 'message', message: { kind: 'tool_result', toolUseId: 't1', isError: false } });
    expect(event?.type === 'message' && event.message.kind === 'tool_result' && event.message.content.length).toBeLessThan(2100);
  });

  it('sums usage over models for a successful result', () => {
    const message = sdk({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'Done.',
      duration_ms: 1200,
      num_turns: 3,
      total_cost_usd: 0.42,
      modelUsage: {
        a: { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 30, cacheCreationInputTokens: 40 },
        b: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 },
      },
    });
    expect(mapSdkMessage(message)).toEqual([
      {
        type: 'result',
        ok: true,
        result: 'Done.',
        error: null,
        usage: { costUsd: 0.42, inputTokens: 11, outputTokens: 22, cacheReadTokens: 33, cacheWriteTokens: 44 },
        durationMs: 1200,
        numTurns: 3,
      },
    ]);
  });

  it('reports error results with their reason', () => {
    const message = sdk({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      errors: ['too many turns'],
      duration_ms: 5,
      num_turns: 50,
      total_cost_usd: 1,
      modelUsage: {},
    });
    expect(mapSdkMessage(message)[0]).toMatchObject({ ok: false, error: 'error_max_turns: too many turns' });
  });
});
