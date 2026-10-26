import { z } from 'zod';

export const runStatusSchema = z.enum(['running', 'succeeded', 'failed', 'cancelled']);
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

export const stepKindSchema = z.enum(['command', 'agent']);

export const runStepSchema = z.object({
  runId: z.string(),
  stepId: z.string(),
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
  agentId: z.string(),
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

export const timelineEntrySchema = z.object({
  seq: z.number().int(),
  at: z.string(),
  stepId: z.string(),
  message: runMessageSchema,
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const runDetailsSchema = z.object({
  run: runSchema,
  steps: z.array(runStepSchema),
  timeline: z.array(timelineEntrySchema),
});
export type RunDetails = z.infer<typeof runDetailsSchema>;

export const startRunBodySchema = z.object({ agentId: z.string().min(1).default('implementer') });

// Events

export const runEvents = {
  started: 'run.started',
  resumed: 'run.resumed',
  completed: 'run.completed',
  stepStarted: 'step.started',
  stepSession: 'step.session',
  stepMessage: 'step.message',
  stepCompleted: 'step.completed',
} as const;

/** What a run will do, fixed when it starts so a restart can continue the same plan. */
export const plannedStepSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('command'), stepId: z.string(), name: z.string(), commands: z.array(z.string()) }),
  z.object({ kind: z.literal('agent'), stepId: z.string(), name: z.string(), agentId: z.string() }),
]);
export type PlannedStep = z.infer<typeof plannedStepSchema>;

export const runStartedSchema = z.object({
  runId: z.string(),
  taskId: z.string(),
  projectId: z.string(),
  agentId: z.string(),
  branch: z.string(),
  worktreePath: z.string(),
  baseRef: z.string(),
  baseSha: z.string(),
  plan: z.array(plannedStepSchema),
});
export const runResumedSchema = z.object({ runId: z.string(), stepId: z.string(), reason: z.string() });
export const runCompletedSchema = z.object({
  runId: z.string(),
  status: runStatusSchema.exclude(['running']),
  commitSha: z.string().nullable(),
  error: z.string().nullable(),
});
export const stepStartedSchema = z.object({
  runId: z.string(),
  stepId: z.string(),
  index: z.number().int(),
  kind: stepKindSchema,
  name: z.string(),
  agentId: z.string().nullable(),
  agentVersion: z.string().nullable(),
});
export const stepSessionSchema = z.object({ runId: z.string(), stepId: z.string(), sessionId: z.string() });
export const stepMessageSchema = z.object({ runId: z.string(), stepId: z.string(), message: runMessageSchema });
export const stepCompletedSchema = z.object({
  runId: z.string(),
  stepId: z.string(),
  status: runStatusSchema.exclude(['running']),
  usage: usageSchema,
  durationMs: z.number().int(),
  numTurns: z.number().int().nullable(),
  result: z.string().nullable(),
  error: z.string().nullable(),
});

export const runStream = (id: string) => `run:${id}`;
