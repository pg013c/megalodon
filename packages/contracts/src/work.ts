import { z } from 'zod';
import { actorSchema } from './events';

// Statuses and transitions exactly as docs/CONCEPTS.md §3. Change both together.

export const taskStatusSchema = z.enum([
  'backlog',
  'blocked',
  'ready',
  'running',
  'needs_you',
  'merging',
  'done',
  'failed',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const manualStatusSchema = z.enum(['todo', 'done', 'verified', 'cancelled']);
export type ManualStatus = z.infer<typeof manualStatusSchema>;

export const taskTransitions: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  backlog: ['blocked', 'ready', 'cancelled'],
  blocked: ['ready', 'cancelled'],
  ready: ['running', 'blocked', 'cancelled'],
  running: ['merging', 'needs_you', 'failed', 'cancelled'],
  needs_you: ['running', 'merging', 'failed', 'cancelled'],
  merging: ['done', 'needs_you'],
  done: [],
  failed: ['ready'],
  cancelled: [],
};

export const manualTransitions: Readonly<Record<ManualStatus, readonly ManualStatus[]>> = {
  todo: ['done', 'cancelled'],
  // back to todo: failed verification, or the operator reopens it
  done: ['verified', 'todo'],
  verified: [],
  cancelled: [],
};

export const taskKindSchema = z.enum(['task', 'manual']);
export type TaskKind = z.infer<typeof taskKindSchema>;

export function canTransition(kind: TaskKind, from: string, to: string): boolean {
  const table: Readonly<Record<string, readonly string[]>> = kind === 'task' ? taskTransitions : manualTransitions;
  return table[from]?.includes(to) ?? false;
}

export const initialStatus = (kind: TaskKind) => (kind === 'task' ? 'backlog' : 'todo');

/** A story's status is derived from its tasks, never stored (ADR-0004). */
export const storyStatusSchema = z.enum(['cancelled', 'done', 'needs_you', 'running', 'ready', 'blocked', 'backlog']);
export type StoryStatus = z.infer<typeof storyStatusSchema>;

export interface StatusOf {
  kind: TaskKind;
  status: string;
}

/** CONCEPTS.md §3, "Story (derived)", rules in order of precedence. */
export function deriveStoryStatus(tasks: readonly StatusOf[]): StoryStatus {
  if (tasks.length === 0) return 'backlog';
  const has = (...statuses: string[]) => tasks.some((t) => statuses.includes(t.status));
  if (tasks.every((t) => t.status === 'cancelled')) return 'cancelled';
  if (tasks.every((t) => ['cancelled', 'done', 'verified'].includes(t.status))) return 'done';
  if (has('needs_you', 'failed') || tasks.some((t) => t.kind === 'manual' && t.status === 'todo')) return 'needs_you';
  if (has('running', 'merging')) return 'running';
  if (has('ready')) return 'ready';
  if (has('blocked')) return 'blocked';
  return 'backlog';
}

// Read models

export const taskSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  /** Per-project number shared by stories and tasks, shown as #12. */
  number: z.number().int().positive(),
  kind: taskKindSchema,
  storyId: z.string().nullable(),
  title: z.string(),
  description: z.string(),
  /** A TaskStatus for `task`, a ManualStatus for `manual`. */
  status: z.union([taskStatusSchema, manualStatusSchema]),
  statusReason: z.string().nullable(),
  statusChangedAt: z.string(),
  createdAt: z.string(),
});
export type Task = z.infer<typeof taskSchema>;

export const storySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
  status: storyStatusSchema,
  taskCount: z.number().int().nonnegative(),
  doneCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type Story = z.infer<typeof storySchema>;

export const projectWorkSchema = z.object({
  stories: z.array(storySchema),
  tasks: z.array(taskSchema),
});
export type ProjectWork = z.infer<typeof projectWorkSchema>;

export const historyEntrySchema = z.object({
  seq: z.number().int(),
  type: z.string(),
  at: z.string(),
  actor: actorSchema,
  data: z.unknown(),
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

export const taskDetailsSchema = z.object({
  task: taskSchema,
  story: storySchema.nullable(),
  history: z.array(historyEntrySchema),
});
export type TaskDetails = z.infer<typeof taskDetailsSchema>;

// Request bodies

const title = z.string().trim().min(1, 'Title is required').max(200);
const description = z.string().max(20_000);

export const createStoryBodySchema = z.object({ title, description: description.default('') });
export const updateStoryBodySchema = z.object({ title: title.optional(), description: description.optional() });
export const createTaskBodySchema = z.object({
  kind: taskKindSchema,
  storyId: z.string().nullable().default(null),
  title,
  description: description.default(''),
});
export const updateTaskBodySchema = z.object({
  title: title.optional(),
  description: description.optional(),
  storyId: z.string().nullable().optional(),
});
export const reasonBodySchema = z.object({ reason: z.string().trim().max(2000).optional() });

// Events

export const workEvents = {
  storyCreated: 'story.created',
  storyUpdated: 'story.updated',
  taskCreated: 'task.created',
  taskUpdated: 'task.updated',
  taskStatusChanged: 'task.status_changed',
} as const;

export const storyCreatedSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  description: z.string(),
});
export const storyUpdatedSchema = z.object({ id: z.string(), title: z.string().optional(), description: z.string().optional() });
export const taskCreatedSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  number: z.number().int().positive(),
  kind: taskKindSchema,
  storyId: z.string().nullable(),
  title: z.string(),
  description: z.string(),
});
export const taskUpdatedSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  storyId: z.string().nullable().optional(),
});
/** The one way a status changes; the projection refuses transitions not in the tables above. */
export const taskStatusChangedSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  reason: z.string().nullable(),
});

export const storyStream = (id: string) => `story:${id}`;
export const taskStream = (id: string) => `task:${id}`;
