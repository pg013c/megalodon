import { z } from 'zod';
import { periodSchema } from './overview';
import { runStatusSchema } from './runs';

/** How one agent version did in a period (ADR-0032). */
export const agentScoreSchema = z.object({
  agentId: z.string(),
  agentVersion: z.string(),
  /** From the library; null when the agent is no longer there. */
  name: z.string().nullable(),
  /** The version in the library now. */
  current: z.boolean(),
  runs: z.number().int(),
  /** Every attempt of its agent steps, including those closed only by the end of their run. */
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
  /**
   * Per attempt that reported its end (succeeded, failed or cancelled, with its cost and duration);
   * attempts still running or closed only by the end of their run are left out; null when there are none.
   */
  avgCostUsd: z.number().nullable(),
  /**
   * Per attempt that reported its end (succeeded, failed or cancelled, with its cost and duration);
   * attempts still running or closed only by the end of their run are left out; null when there are none.
   */
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
  /** Per finished run (succeeded, failed or cancelled): the sum of its step attempt costs; null when none finished. */
  avgCostUsd: z.number().nullable(),
  /**
   * Per finished run: working time, the sum of its step attempt durations (no time parked at a gate
   * or queued); null when none finished.
   */
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

/** One run behind a scorecard row: for an agent, only its steps in the period count (ADR-0033). */
export const scorecardRunSchema = z.object({
  runId: z.string(),
  /** Null when the run or its task is no longer in the read model. */
  taskId: z.string().nullable(),
  taskNumber: z.number().int().nullable(),
  taskTitle: z.string().nullable(),
  projectId: z.string(),
  /** Null when the project has been disconnected. */
  projectName: z.string().nullable(),
  status: runStatusSchema,
  startedAt: z.string(),
  /** For an agent, its step attempts in the run; for a pipeline, the most attempts any step took. */
  attempts: z.number().int(),
  rework: z.number().int(),
  reviewScore: z.number().nullable(),
  costUsd: z.number(),
  durationMs: z.number().int().nullable(),
  merged: z.boolean(),
});
export type ScorecardRun = z.infer<typeof scorecardRunSchema>;

export const scorecardRunsSchema = z.object({
  /** Every run behind the row; `runs` holds the latest 100. */
  total: z.number().int(),
  runs: z.array(scorecardRunSchema),
});
export type ScorecardRuns = z.infer<typeof scorecardRunsSchema>;

/** The runs behind one agent version or one pipeline version, with the scorecard's filters. */
export const scorecardRunsQuerySchema = scorecardQuerySchema
  .extend({
    agentId: z.string().min(1).optional(),
    agentVersion: z.string().min(1).optional(),
    pipelineId: z.string().min(1).optional(),
    pipelineVersion: z.string().min(1).optional(),
  })
  .refine(
    (q) => {
      const agent = q.agentId !== undefined && q.agentVersion !== undefined;
      const pipeline = q.pipelineId !== undefined && q.pipelineVersion !== undefined;
      const given = [q.agentId, q.agentVersion, q.pipelineId, q.pipelineVersion].filter((v) => v !== undefined).length;
      return (agent || pipeline) && given === 2;
    },
    { message: 'give agentId and agentVersion, or pipelineId and pipelineVersion', path: ['target'] },
  );
