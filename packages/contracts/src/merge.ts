import { z } from 'zod';

/** The merge queue (ADR-0008, ADR-0014, ADR-0027). Task-level events go to `task:<id>`. */
export const mergeEvents = {
  started: 'merge.started',
  updated: 'merge.updated',
  conflict: 'merge.conflict',
  resolved: 'merge.resolved',
  completed: 'merge.completed',
  failed: 'merge.failed',
  recovered: 'merge.recovered',
  /** The project's merges wait for the operator's checkout. */
  blocked: 'merge.blocked',
  unblocked: 'merge.unblocked',
} as const;

export const mergeStream = (projectId: string) => `merge:${projectId}`;

export const mergeBlockedSchema = z.object({ projectId: z.string(), reason: z.string() });
export const mergeUnblockedSchema = z.object({ projectId: z.string() });

export const mergeBlockSchema = z.object({ projectId: z.string(), projectName: z.string(), reason: z.string() });
export type MergeBlock = z.infer<typeof mergeBlockSchema>;
