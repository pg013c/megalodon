import { z } from 'zod';
import { requirementSchema, taskSchema } from './work';

/** The global queue (CONCEPTS.md §5, ADR-0007). */
export const schedulerStateSchema = z.object({
  slots: z.number().int().min(1).max(50),
  /** `operator`: paused by you; `plan_limit`: the subscription's limit was reached. */
  paused: z.enum(['operator', 'plan_limit']).nullable(),
  /** When a plan-limit pause ends on its own. */
  pausedUntil: z.string().nullable(),
});
export type SchedulerState = z.infer<typeof schedulerStateSchema>;

export const queueEntrySchema = z.object({
  task: taskSchema,
  projectName: z.string(),
  runId: z.string().nullable(),
  /** For waiting tasks: what they wait for (unmet requirements). */
  waitingFor: z.array(requirementSchema),
});
export type QueueEntry = z.infer<typeof queueEntrySchema>;

export const queueViewSchema = z.object({
  state: schedulerStateSchema,
  running: z.array(queueEntrySchema),
  /** Ready and blocked tasks in the order the scheduler considers them. */
  waiting: z.array(queueEntrySchema),
});
export type QueueView = z.infer<typeof queueViewSchema>;

export const schedulerEvents = {
  slotsSet: 'scheduler.slots_set',
  paused: 'scheduler.paused',
  resumed: 'scheduler.resumed',
} as const;

export const SCHEDULER_STREAM = 'scheduler';
export const DEFAULT_SLOTS = 3;

export const slotsSetSchema = z.object({ slots: schedulerStateSchema.shape.slots });
export const schedulerPausedSchema = z.object({ reason: z.enum(['operator', 'plan_limit']), until: z.string().nullable(), detail: z.string().nullable() });
export const setSlotsBodySchema = slotsSetSchema;
