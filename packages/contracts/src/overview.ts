import { z } from 'zod';
import { needsYouKindSchema } from './needsYou';
import { projectSchema } from './projects';
import { taskSchema } from './work';

export const periodSchema = z.enum(['24h', '7d', '30d', 'all']);
export type Period = z.infer<typeof periodSchema>;

/** A task an agent works on now, and where it is in its pipeline. */
export const activeWorkSchema = z.object({
  task: taskSchema,
  runId: z.string().nullable(),
  /** The step running now, e.g. "Implementer", or what the task waits for while merging. */
  step: z.string(),
  attempt: z.number().int().nullable(),
  since: z.string(),
});
export type ActiveWork = z.infer<typeof activeWorkSchema>;

export const projectOverviewSchema = z.object({
  project: projectSchema,
  /** Tasks (not manual) per status. */
  counts: z.record(z.string(), z.number().int()),
  /** Done tasks and all tasks except cancelled ones, for progress. */
  done: z.number().int(),
  total: z.number().int(),
  active: z.array(activeWorkSchema),
  needsYou: z.number().int(),
  /** Agent spend in the period: runs, triage and conflict resolution. */
  costUsd: z.number(),
  agentTimeMs: z.number().int(),
  merged: z.number().int(),
  mergeBlocked: z.string().nullable(),
});
export type ProjectOverview = z.infer<typeof projectOverviewSchema>;

export const overviewSchema = z.object({
  period: periodSchema,
  needsYou: z.object({
    total: z.number().int(),
    byKind: z.partialRecord(needsYouKindSchema, z.number().int()),
  }),
  projects: z.array(projectOverviewSchema),
  totals: z.object({ costUsd: z.number(), agentTimeMs: z.number().int(), merged: z.number().int(), running: z.number().int() }),
});
export type Overview = z.infer<typeof overviewSchema>;
