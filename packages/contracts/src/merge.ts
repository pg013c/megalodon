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
  pushed: 'merge.pushed',
  pushFailed: 'merge.push_failed',
  /** The project's merges wait for the operator's checkout. */
  blocked: 'merge.blocked',
  unblocked: 'merge.unblocked',
} as const;

export const mergeStream = (projectId: string) => `merge:${projectId}`;

/** The task's branch is in the base; `runId` is the run it came from, null when the task had none. */
export const mergeCompletedSchema = z.object({ taskId: z.string(), runId: z.string().nullable(), sha: z.string() });
export const mergeBlockedSchema = z.object({ projectId: z.string(), reason: z.string() });
export const mergeUnblockedSchema = z.object({ projectId: z.string() });

export const mergeBlockSchema = z.object({ projectId: z.string(), projectName: z.string(), reason: z.string() });
export type MergeBlock = z.infer<typeof mergeBlockSchema>;
