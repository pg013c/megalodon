import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zeroUsage } from '@megalodon/contracts';
import type { AgentRunInput, AgentRuntime, RuntimeEvent } from '../runtime/types';

export interface Script {
  /** Files the "agent" writes into its worktree. */
  files?: Record<string, string>;
  ok?: boolean;
  error?: string;
  /** Wait until aborted instead of finishing. */
  hang?: boolean;
  costUsd?: number;
}

/** A runtime for tests: no model calls, behaviour chosen per run. */
export class ScriptedRuntime implements AgentRuntime {
  readonly calls: AgentRunInput[] = [];
  constructor(private readonly script: (input: AgentRunInput) => Script = () => ({})) {}

  async *run(input: AgentRunInput): AsyncIterable<RuntimeEvent> {
    this.calls.push(input);
    const script = this.script(input);
    yield { type: 'session', sessionId: input.resumeSessionId ?? `session-${this.calls.length}` };
    yield { type: 'message', message: { kind: 'text', text: 'Working on it.' } };
    for (const [path, content] of Object.entries(script.files ?? {})) {
      yield { type: 'message', message: { kind: 'tool_use', toolUseId: path, name: 'Write', input: JSON.stringify({ path }) } };
      writeFileSync(join(input.cwd, path), content);
      yield { type: 'message', message: { kind: 'tool_result', toolUseId: path, isError: false, content: 'ok' } };
    }
    if (script.hang) {
      if (!input.signal.aborted) {
        await new Promise<void>((resolve) => input.signal.addEventListener('abort', () => resolve(), { once: true }));
      }
      yield { type: 'result', ok: false, result: null, error: 'Stopped', usage: zeroUsage, durationMs: 1, numTurns: 1 };
      return;
    }
    const ok = script.ok ?? true;
    yield {
      type: 'result',
      ok,
      result: ok ? 'Changed the files.' : null,
      error: ok ? null : (script.error ?? 'failed'),
      usage: { ...zeroUsage, costUsd: script.costUsd ?? 0.01, inputTokens: 100, outputTokens: 50 },
      durationMs: 10,
      numTurns: 2,
    };
  }
}
