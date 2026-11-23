import { z } from 'zod';
import { periodSchema } from './overview';

/** How one agent version did in a period (ADR-0032). */
export const agentScoreSchema = z.object({
  agentId: z.string(),
  agentVersion: z.string(),
  /** From the library; null when the agent is no longer there. */
  name: z.string().nullable(),
  /** The version in the library now. */
  current: z.boolean(),
  runs: z.number().int(),
  /** Attempts of its agent steps. */
  steps: z.number().int(),
  succeeded: z.number().int(),
  /** Succeeded of the attempts that succeeded or failed; null when none ended. */
  successRate: z.number().nullable(),
  /** Attempts a retry after failed checks or a failed review sent the run back to. */
  rework: z.number().int(),
  /** Attempts a review scored, and their average score. */
  reviewed: z.number().int(),
  reviewScore: z.number().nullable(),
  /** Cost of all its attempts in the period. */
  costUsd: z.number(),
  /** Per attempt that ended (succeeded, failed or cancelled); null when none ended. */
  avgCostUsd: z.number().nullable(),
  avgDurationMs: z.number().nullable(),
  /** Decisions it made, and how many of them a later decision overrode. */
  decisions: z.number().int(),
  overridden: z.number().int(),
});
export type AgentScore = z.infer<typeof agentScoreSchema>;

/** How one pipeline version did in a period (ADR-0032). */
export const pipelineScoreSchema = z.object({
  pipelineId: z.string(),
  pipelineVersion: z.string(),
  name: z.string().nullable(),
  current: z.boolean(),
  runs: z.number().int(),
  /** Runs that succeeded, failed or were cancelled. */
  finished: z.number().int(),
  merged: z.number().int(),
  /** Merged with no decision of the operator on the run. */
  mergedUnattended: z.number().int(),
  /** mergedUnattended of finished; null when none finished. */
  unattendedRate: z.number().nullable(),
  /** Per finished run: the most attempts any of its steps took; null when none finished. */
  avgAttempts: z.number().nullable(),
  /** Cost of all its runs in the period. */
  costUsd: z.number(),
  /** Per finished run: cost, and working time (the sum of its step durations). */
  avgCostUsd: z.number().nullable(),
  avgDurationMs: z.number().nullable(),
});
export type PipelineScore = z.infer<typeof pipelineScoreSchema>;

export const scorecardSchema = z.object({
  period: periodSchema,
  projectId: z.string().nullable(),
  agents: z.array(agentScoreSchema),
  pipelines: z.array(pipelineScoreSchema),
});
export type Scorecard = z.infer<typeof scorecardSchema>;

export const scorecardQuerySchema = z.object({
  projectId: z.string().min(1).optional(),
  period: periodSchema.default('30d'),
});
