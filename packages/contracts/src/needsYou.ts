import { z } from 'zod';
import { mergeBlockSchema } from './merge';
import { schedulerStateSchema } from './queue';
import { taskSchema } from './work';

/** Why something waits for the operator. */
export const needsYouKindSchema = z.enum(['plan', 'review', 'failed', 'manual', 'queue', 'triage']);
export type NeedsYouKind = z.infer<typeof needsYouKindSchema>;

export const needsYouItemSchema = z.object({
  kind: needsYouKindSchema,
  task: taskSchema,
  projectName: z.string(),
  reason: z.string(),
  /** The run to look at, when there is one. */
  runId: z.string().nullable(),
  /** The decision to override to let the work go on (plan approval, held merge, held queue). */
  decisionId: z.string().nullable(),
  /** The task's run has commits the operator can merge. */
  mergeable: z.boolean(),
  since: z.string(),
});
export type NeedsYouItem = z.infer<typeof needsYouItemSchema>;

/** Everything that waits for the operator, across projects (PRD FR-2). Oldest first. */
export const needsYouSchema = z.object({
  items: z.array(needsYouItemSchema),
  mergeBlocked: z.array(mergeBlockSchema),
  scheduler: schedulerStateSchema,
});
export type NeedsYou = z.infer<typeof needsYouSchema>;
