import { z } from 'zod';
import { checkSchema } from './projects';
import { decisionSchema } from './decisions';
import { gateSchema } from './pipelines';

/** `waiting`: stopped at a gate for the operator (the plan); it takes no slot. */
export const runStatusSchema = z.enum(['running', 'waiting', 'succeeded', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const usageSchema = z.object({
  costUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof usageSchema>;
export const zeroUsage: Usage = { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export const addUsage = (a: Usage, b: Usage): Usage => ({
  costUsd: a.costUsd + b.costUsd,
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});

export const stepKindSchema = z.enum(['command', 'agent', 'check']);

export const runStepSchema = z.object({
  runId: z.string(),
  stepId: z.string(),
  /** 1 for the first run of the step, 2 after the first retry, … */
  attempt: z.number().int().positive(),
  index: z.number().int(),
  kind: stepKindSchema,
  name: z.string(),
  agentId: z.string().nullable(),
  agentVersion: z.string().nullable(),
  status: runStatusSchema,
  sessionId: z.string().nullable(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
  numTurns: z.number().int().nullable(),
  usage: usageSchema,
  result: z.string().nullable(),
  error: z.string().nullable(),
});
export type RunStep = z.infer<typeof runStepSchema>;

export const runSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  projectId: z.string(),
  pipelineId: z.string(),
  pipelineVersion: z.string(),
  status: runStatusSchema,
  branch: z.string(),
  worktreePath: z.string(),
  baseRef: z.string(),
  baseSha: z.string(),
  commitSha: z.string().nullable(),
  error: z.string().nullable(),
  usage: usageSchema,
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  durationMs: z.number().int().nullable(),
});
export type Run = z.infer<typeof runSchema>;

/** One entry of a step's live transcript, as stored in the `step.message` event. */
export const runMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), text: z.string() }),
  z.object({ kind: z.literal('tool_use'), toolUseId: z.string(), name: z.string(), input: z.string() }),
  z.object({ kind: z.literal('tool_result'), toolUseId: z.string(), isError: z.boolean(), content: z.string() }),
  z.object({ kind: z.literal('output'), text: z.string() }),
]);
export type RunMessage = z.infer<typeof runMessageSchema>;

/** One entry of a run's timeline: what an agent or command did, or a decision. */
export const timelineEntrySchema = z.object({
  seq: z.number().int(),
  at: z.string(),
  stepId: z.string().nullable(),
  item: z.discriminatedUnion('type', [
    z.object({ type: z.literal('message'), message: runMessageSchema }),
    z.object({ type: z.literal('decision'), decision: decisionSchema }),
  ]),
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const runDetailsSchema = z.object({
  run: runSchema,
  plan: z.array(z.lazy(() => plannedStepSchema)),
  /** Every attempt of every step, in order. */
  steps: z.array(runStepSchema),
  timeline: z.array(timelineEntrySchema),
});
export type RunDetails = z.infer<typeof runDetailsSchema>;

/** A pipeline by id (default `feature`), or a single agent. */
export const startRunBodySchema = z
  .object({ pipelineId: z.string().min(1).optional(), agentId: z.string().min(1).optional() })
  .refine((b) => !(b.pipelineId && b.agentId), 'Give a pipeline or an agent, not both');

// Events

export const runEvents = {
  started: 'run.started',
  resumed: 'run.resumed',
  completed: 'run.completed',
  waiting: 'run.waiting',
  stepStarted: 'step.started',
  stepSession: 'step.session',
  stepMessage: 'step.message',
  stepCompleted: 'step.completed',
} as const;

/** What a run will do, fixed when it starts so a restart can continue the same plan. */
const retrySchema = z.object({ retry: z.string(), max: z.number().int().min(0) });

export const plannedStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('command'), stepId: z.string(), name: z.string(), commands: z.array(z.string()) }),
  z.object({
    kind: z.literal('agent'),
    stepId: z.string(),
    name: z.string(),
    agentId: z.string(),
    gate: gateSchema.nullable().default(null),
    onFail: retrySchema.nullable().default(null),
  }),
  z.object({ kind: z.literal('check'), stepId: z.string(), name: z.string(), checks: z.array(checkSchema), onFail: retrySchema.nullable() }),
]);
export type PlannedStep = z.infer<typeof plannedStepSchema>;

// Step 3 runs named an agent instead of a pipeline; they read as a one-agent pipeline.
const legacyAgentRun = (data: unknown) =>
  data && typeof data === 'object' && 'agentId' in data && !('pipelineId' in data)
    ? { ...data, pipelineId: `agent:${String((data as { agentId: unknown }).agentId)}`, pipelineVersion: 'unknown' }
    : data;

export const runStartedSchema = z.preprocess(legacyAgentRun, z.object({
  runId: z.string(),
  taskId: z.string(),
  projectId: z.string(),
  pipelineId: z.string(),
  pipelineVersion: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
  baseRef: z.string(),
  baseSha: z.string(),
  plan: z.array(plannedStepSchema),
}));
export const runResumedSchema = z.object({ runId: z.string(), stepId: z.string(), reason: z.string() });
export const runWaitingSchema = z.object({ runId: z.string(), reason: z.string() });
export const runCompletedSchema = z.object({
  runId: z.string(),
  status: runStatusSchema.exclude(['running', 'waiting']),
  commitSha: z.string().nullable(),
  error: z.string().nullable(),
});
export const stepStartedSchema = z.object({
  runId: z.string(),
  stepId: z.string(),
  attempt: z.number().int().positive().default(1),
  index: z.number().int(),
  kind: stepKindSchema,
  name: z.string(),
  agentId: z.string().nullable(),
  agentVersion: z.string().nullable(),
});
export const stepSessionSchema = z.object({ runId: z.string(), stepId: z.string(), attempt: z.number().int().positive().default(1), sessionId: z.string() });
export const stepMessageSchema = z.object({ runId: z.string(), stepId: z.string(), attempt: z.number().int().positive().default(1), message: runMessageSchema });
export const stepCompletedSchema = z.object({
  runId: z.string(),
  stepId: z.string(),
  attempt: z.number().int().positive().default(1),
  /** For agents with an output contract: the validated output. */
  output: z.unknown().optional(),
  status: runStatusSchema.exclude(['running', 'waiting']),
  usage: usageSchema,
  durationMs: z.number().int(),
  numTurns: z.number().int().nullable(),
  result: z.string().nullable(),
  error: z.string().nullable(),
});

export const runStream = (id: string) => `run:${id}`;
