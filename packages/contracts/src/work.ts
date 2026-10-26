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

/** Where a task stands in triage (CONCEPTS.md §1). `none`: not triaged (manual tasks, older tasks). */
export const triageStateSchema = z.enum(['none', 'pending', 'running', 'done', 'failed']);

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
  /** Predicted touch-set: repository paths or globs the task changes. */
  touches: z.array(z.string()),
  pipelineId: z.string(),
  /** Moved to the front of the queue by the operator. */
  front: z.boolean(),
  triage: triageStateSchema,
  triageSummary: z.string().nullable(),
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

// Dependencies (CONCEPTS.md §4). `collision` is never stored: the scheduler computes it.

export const dependencyKindSchema = z.enum(['code', 'manual', 'external']);
export type DependencyKind = z.infer<typeof dependencyKindSchema>;

export const dependencySchema = z.object({
  id: z.string(),
  taskId: z.string(),
  kind: dependencyKindSchema,
  /** The task or story it waits for; null for external dependencies. */
  target: z.object({ type: z.enum(['task', 'story']), id: z.string() }).nullable(),
  /** Why it is needed, or for an external dependency what must be true. */
  description: z.string(),
  /** External only: a shell command, written by the operator, that passes when the condition holds. */
  command: z.string().nullable(),
  /** External only: met by the operator or by its command. */
  met: z.boolean(),
  createdAt: z.string(),
});
export type Dependency = z.infer<typeof dependencySchema>;

/** One thing a task needs before it can start, as the board shows it. */
export const requirementSchema = z.object({
  kind: z.enum(['code', 'manual', 'external', 'collision']),
  label: z.string(),
  met: z.boolean(),
  dependencyId: z.string().nullable(),
  /** The task or story it points to, for links. */
  ref: z.object({ type: z.enum(['task', 'story']), id: z.string(), number: z.number().int() }).nullable(),
});
export type Requirement = z.infer<typeof requirementSchema>;

export const projectWorkSchema = z.object({
  stories: z.array(storySchema),
  tasks: z.array(taskSchema),
  /** Per task id: what it needs to start. */
  requirements: z.record(z.string(), z.array(requirementSchema)),
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
  dependencies: z.array(dependencySchema),
  requirements: z.array(requirementSchema),
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
export const addDependencyBodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('code'), target: z.object({ type: z.enum(['task', 'story']), id: z.string() }), description: z.string().default('') }),
  z.object({ kind: z.literal('manual'), target: z.object({ type: z.literal('task'), id: z.string() }), description: z.string().default('') }),
  z.object({ kind: z.literal('external'), description: z.string().trim().min(1), command: z.string().trim().min(1).nullable().default(null) }),
]);
export const setTouchesBodySchema = z.object({ touches: z.array(z.string().trim().min(1)) });
export const setPipelineBodySchema = z.object({ pipelineId: z.string().min(1) });

// Events

export const workEvents = {
  storyCreated: 'story.created',
  storyUpdated: 'story.updated',
  taskCreated: 'task.created',
  taskUpdated: 'task.updated',
  taskStatusChanged: 'task.status_changed',
  taskTouchesSet: 'task.touches_set',
  taskPipelineSet: 'task.pipeline_set',
  taskMovedToFront: 'task.moved_to_front',
  triageRequested: 'triage.requested',
  triageStarted: 'triage.started',
  triageCompleted: 'triage.completed',
  triageFailed: 'triage.failed',
  dependencyAdded: 'dependency.added',
  dependencyRemoved: 'dependency.removed',
  dependencyMet: 'dependency.met',
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

export const taskTouchesSetSchema = z.object({ id: z.string(), touches: z.array(z.string()) });
export const taskPipelineSetSchema = z.object({ id: z.string(), pipelineId: z.string() });
export const taskMovedToFrontSchema = z.object({ id: z.string() });
export const triageEventSchema = z.object({ taskId: z.string(), summary: z.string().optional(), error: z.string().optional() });
export const dependencyAddedSchema = dependencySchema.omit({ createdAt: true, met: true });
export const dependencyRemovedSchema = z.object({ id: z.string() });
export const dependencyMetSchema = z.object({ id: z.string() });
