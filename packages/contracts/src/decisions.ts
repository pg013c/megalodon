import { z } from 'zod';
import { actorSchema } from './events';

/**
 * A recorded choice (CONCEPTS.md §7). `alternatives` are the outcomes that were possible; an
 * override picks another one of them and supersedes this decision.
 */
export const decisionSchema = z.object({
  id: z.string(),
  taskId: z.string(),
  runId: z.string().nullable(),
  stepId: z.string().nullable(),
  /** What was decided, e.g. `gate`, `retry`, `review.verdict`. */
  kind: z.string(),
  outcome: z.string(),
  rationale: z.string(),
  alternatives: z.array(z.string()),
  inputs: z.record(z.string(), z.unknown()),
  actor: actorSchema,
  at: z.string(),
  /** Set when a later decision overrides this one. */
  supersededBy: z.string().nullable(),
  /** The decision this one overrides. */
  overrides: z.string().nullable(),
});
export type Decision = z.infer<typeof decisionSchema>;

export const decisionEvents = { made: 'decision.made' } as const;

export const decisionMadeSchema = decisionSchema.omit({ actor: true, at: true, supersededBy: true });

export const overrideDecisionBodySchema = z.object({
  outcome: z.string().min(1),
  rationale: z.string().trim().min(1, 'Say why').max(2000),
});

export const decisionKindLabel: Record<string, string> = {
  'review.verdict': 'Review verdict',
  gate: 'Gate',
  retry: 'Retry',
};
