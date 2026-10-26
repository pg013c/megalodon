import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zeroUsage } from '@megalodon/contracts';
import { isLimit } from '../runtime/claude';
import type { AgentRunInput, AgentRuntime, RuntimeEvent } from '../runtime/types';

export interface Script {
  /** Files the "agent" writes into its worktree. */
  files?: Record<string, string>;
  /** Structured answer for agents with an output contract. */
  output?: unknown;
  ok?: boolean;
  error?: string;
  /** Wait until aborted instead of finishing. */
  hang?: boolean;
  costUsd?: number;
}

/** A runtime for tests: no model calls; `script` decides per call (counted from 1) what happens. */
export class ScriptedRuntime implements AgentRuntime {
  readonly calls: AgentRunInput[] = [];
  constructor(private readonly script: (input: AgentRunInput, call: number) => Script = () => ({})) {}

  async *run(input: AgentRunInput): AsyncIterable<RuntimeEvent> {
    this.calls.push(input);
    const script = this.script(input, this.calls.length);
    yield { type: 'session', sessionId: input.resumeSessionId ?? `session-${this.calls.length}` };
    yield { type: 'message', message: { kind: 'text', text: `${input.agent.name} is working.` } };
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
      result: ok ? `${input.agent.name} finished.` : null,
      ...(script.output !== undefined ? { output: script.output } : {}),
      error: ok ? null : (script.error ?? 'failed'),
      ...(!ok && isLimit(script.error ?? null) ? { limited: true } : {}),
      usage: { ...zeroUsage, costUsd: script.costUsd ?? 0.01, inputTokens: 100, outputTokens: 50 },
      durationMs: 10,
      numTurns: 2,
    };
  }
}
