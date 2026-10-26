import { randomUUID } from 'node:crypto';
import {
  canTransition,
  type Dependency,
  type Requirement,
  storyStream,
  taskStream,
  workEvents,
  type Actor,
  type ProjectWork,
  type Story,
  type Task,
  type TaskDetails,
  type TaskKind,
  type NewEvent,
} from '@megalodon/contracts';
import { AppError } from '../errors';
import type { EventStore } from '../events/store';
import type { ProjectsQueries } from '../projects/projection';
import type { WorkQueries } from './projection';
import { requirementsOf } from './readiness';

const OPERATOR: Actor = { kind: 'operator' };

/** Stories, tasks and manual tasks, and every change of their status. */
export class WorkService {
  constructor(
    private readonly store: EventStore,
    readonly queries: WorkQueries,
    private readonly projects: ProjectsQueries,
  ) {}

  /** Adds what the scheduler knows (collisions) to a task's requirements. */
  private extraRequirements: (task: Task) => Requirement[] = () => [];
  setExtraRequirements(fn: (task: Task) => Requirement[]): void {
    this.extraRequirements = fn;
  }

  requirements(task: Task): Requirement[] {
    return [...requirementsOf(task, this.queries), ...this.extraRequirements(task)];
  }

  work(projectId: string): ProjectWork {
    this.project(projectId);
    const tasks = this.queries.tasks(projectId);
    return {
      stories: this.queries.stories(projectId),
      tasks,
      requirements: Object.fromEntries(tasks.map((t) => [t.id, this.requirements(t)])),
    };
  }

  details(taskId: string): TaskDetails {
    const task = this.task(taskId);
    const history = this.store.readStream(taskStream(taskId)).map(({ seq, type, at, actor, data }) => ({ seq, type, at, actor, data }));
    return {
      task,
      story: task.storyId ? this.queries.story(task.storyId) : null,
      dependencies: this.queries.dependencies(taskId),
      requirements: this.requirements(task),
      history,
    };
  }

  createStory(projectId: string, input: { title: string; description: string }): Story {
    this.project(projectId);
    const id = randomUUID();
    const number = this.queries.nextNumber(projectId);
    this.store.append([
      { type: workEvents.storyCreated, stream: storyStream(id), data: { id, projectId, number, ...input }, actor: OPERATOR },
    ]);
    return this.story(id);
  }

  updateStory(id: string, input: { title?: string; description?: string }): Story {
    this.story(id);
    this.store.append([{ type: workEvents.storyUpdated, stream: storyStream(id), data: { id, ...input }, actor: OPERATOR }]);
    return this.story(id);
  }

  createTask(projectId: string, input: { kind: TaskKind; storyId: string | null; title: string; description: string }): Task {
    this.project(projectId);
    if (input.storyId !== null) this.storyInProject(input.storyId, projectId);
    const id = randomUUID();
    const number = this.queries.nextNumber(projectId);
    this.store.append([
      { type: workEvents.taskCreated, stream: taskStream(id), data: { id, projectId, number, ...input }, actor: OPERATOR },
    ]);
    return this.task(id);
  }

  updateTask(id: string, input: { title?: string; description?: string; storyId?: string | null }): Task {
    const task = this.task(id);
    if (input.storyId) this.storyInProject(input.storyId, task.projectId);
    this.store.append([{ type: workEvents.taskUpdated, stream: taskStream(id), data: { id, ...input }, actor: OPERATOR }]);
    return this.task(id);
  }

  /** The operator stops a task (or a manual task) for good. */
  cancel(id: string, reason?: string): Task {
    return this.transition(id, 'cancelled', reason ?? null, OPERATOR);
  }

  /** The operator marks a manual task as done. */
  complete(id: string): Task {
    this.manual(id);
    return this.transition(id, 'done', null, OPERATOR);
  }

  /** The operator takes back a manual task marked done by mistake. */
  reopen(id: string, reason?: string): Task {
    this.manual(id);
    return this.transition(id, 'todo', reason ?? null, OPERATOR);
  }

  /** Puts a task in the queue without triage; the scheduler then decides ready or blocked. */
  queue(id: string): Task {
    return this.transition(id, 'ready', 'Queued by you', OPERATOR);
  }

  /** A failed task goes back to the queue. */
  retry(id: string): Task {
    return this.transition(id, 'ready', 'Retried by you', OPERATOR);
  }

  moveToFront(id: string): Task {
    const task = this.task(id);
    if (task.status !== 'ready' && task.status !== 'blocked') throw new AppError(409, 'NOT_QUEUED', `#${task.number} is not in the queue`);
    this.store.append([{ type: workEvents.taskMovedToFront, stream: taskStream(id), data: { id }, actor: OPERATOR }]);
    return this.task(id);
  }

  setTouches(id: string, touches: string[], actor: Actor = OPERATOR): Task {
    this.task(id);
    this.store.append([{ type: workEvents.taskTouchesSet, stream: taskStream(id), data: { id, touches }, actor }]);
    return this.task(id);
  }

  setPipeline(id: string, pipelineId: string, actor: Actor = OPERATOR): Task {
    this.task(id);
    this.store.append([{ type: workEvents.taskPipelineSet, stream: taskStream(id), data: { id, pipelineId }, actor }]);
    return this.task(id);
  }

  /** The event for a dependency, validated: same project, no self-reference, no cycle of code dependencies. */
  dependencyEvent(
    taskId: string,
    input: { kind: Dependency['kind']; target: Dependency['target']; description: string; command: string | null },
    actor: Actor,
  ): NewEvent {
    const task = this.task(taskId);
    if (input.kind !== 'external') {
      const target = input.target;
      if (!target) throw new AppError(400, 'TARGET_REQUIRED', 'A code or manual dependency needs a task or story');
      const projectId = target.type === 'task' ? this.queries.task(target.id)?.projectId : this.queries.story(target.id)?.projectId;
      if (!projectId) throw new AppError(404, 'TARGET_NOT_FOUND', 'The task or story does not exist');
      if (projectId !== task.projectId) throw new AppError(400, 'TARGET_IN_OTHER_PROJECT', 'Dependencies stay within one project');
      if (target.id === taskId || (target.type === 'story' && target.id === task.storyId)) {
        throw new AppError(400, 'DEPENDS_ON_ITSELF', 'A task cannot wait for itself or its own story');
      }
      if (input.kind === 'manual' && this.queries.task(target.id)?.kind !== 'manual') {
        throw new AppError(400, 'NOT_A_MANUAL_TASK', 'A manual dependency points to a manual task');
      }
      if (this.waitsFor(target, taskId, new Set())) throw new AppError(409, 'DEPENDENCY_CYCLE', 'This would make tasks wait for each other');
    }
    return {
      type: workEvents.dependencyAdded,
      stream: taskStream(taskId),
      data: { id: randomUUID(), taskId, kind: input.kind, target: input.target, description: input.description, command: input.command },
      actor,
    };
  }

  addDependency(taskId: string, input: Parameters<WorkService['dependencyEvent']>[1]): Dependency {
    const [event] = this.store.append([this.dependencyEvent(taskId, input, OPERATOR)]);
    return this.queries.dependency((event!.data as { id: string }).id)!;
  }

  removeDependency(id: string): void {
    const dependency = this.queries.dependency(id);
    if (!dependency) throw new AppError(404, 'DEPENDENCY_NOT_FOUND', `No dependency ${id}`);
    this.store.append([{ type: workEvents.dependencyRemoved, stream: taskStream(dependency.taskId), data: { id }, actor: OPERATOR }]);
  }

  /** An external dependency holds: the operator says so, or its command passed. */
  markMet(id: string, actor: Actor = OPERATOR): Dependency {
    const dependency = this.queries.dependency(id);
    if (!dependency) throw new AppError(404, 'DEPENDENCY_NOT_FOUND', `No dependency ${id}`);
    if (dependency.kind !== 'external') throw new AppError(400, 'NOT_EXTERNAL', 'Only external dependencies are marked as met');
    if (!dependency.met) this.store.append([{ type: workEvents.dependencyMet, stream: taskStream(dependency.taskId), data: { id }, actor }]);
    return this.queries.dependency(id)!;
  }

  /** Does `from` (transitively) wait for task `taskId`? */
  private waitsFor(from: { type: 'task' | 'story'; id: string }, taskId: string, seen: Set<string>): boolean {
    if (seen.has(from.id)) return false;
    seen.add(from.id);
    const tasks = from.type === 'task' ? [this.queries.task(from.id)].filter((t): t is Task => t !== null) : this.queries.storyTasks(from.id);
    for (const t of tasks) {
      if (t.id === taskId) return true;
      for (const d of this.queries.dependencies(t.id)) if (d.target && this.waitsFor(d.target, taskId, seen)) return true;
    }
    return false;
  }

  /** The only way a status changes; refuses what CONCEPTS.md §3 does not allow. */
  transition(id: string, to: string, reason: string | null, actor: Actor): Task {
    const task = this.task(id);
    if (!canTransition(task.kind, task.status, to)) {
      throw new AppError(409, 'INVALID_TRANSITION', `#${task.number} cannot go from ${task.status} to ${to}`);
    }
    this.store.append([
      { type: workEvents.taskStatusChanged, stream: taskStream(id), data: { id, from: task.status, to, reason }, actor },
    ]);
    return this.task(id);
  }

  private project(id: string) {
    const project = this.projects.get(id);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', `No project ${id}`);
    return project;
  }

  private task(id: string): Task {
    const task = this.queries.task(id);
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', `No task ${id}`);
    return task;
  }

  private story(id: string): Story {
    const story = this.queries.story(id);
    if (!story) throw new AppError(404, 'STORY_NOT_FOUND', `No story ${id}`);
    return story;
  }

  private storyInProject(storyId: string, projectId: string): void {
    if (this.story(storyId).projectId !== projectId) {
      throw new AppError(400, 'STORY_IN_OTHER_PROJECT', 'A task and its story must belong to the same project');
    }
  }

  private manual(id: string): void {
    if (this.task(id).kind !== 'manual') throw new AppError(400, 'NOT_A_MANUAL_TASK', 'Only manual tasks are completed by the operator');
  }
}
