import type { Agent, RunMessage, Usage } from '@megalodon/contracts';

export interface AgentRunInput {
  agent: Agent;
  /** The run's worktree; the agent works only here. */
  cwd: string;
  prompt: string;
  /** Continue an interrupted session instead of starting a new one. */
  resumeSessionId?: string;
  env: Record<string, string>;
  signal: AbortSignal;
}

export type RuntimeEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'message'; message: RunMessage }
  | {
      type: 'result';
      ok: boolean;
      result: string | null;
      /** The structured answer, for agents with an output contract. */
      output?: unknown;
      error: string | null;
      usage: Usage;
      durationMs: number;
      numTurns: number | null;
    };

/** Runs one agent and streams what it does (ADR-0012). The only provider today is Claude. */
export interface AgentRuntime {
  run(input: AgentRunInput): AsyncIterable<RuntimeEvent>;
}

/** Keeps stored transcripts bounded: tool output can be whole files. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters)`;
}
