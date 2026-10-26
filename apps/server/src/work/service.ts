import { randomUUID } from 'node:crypto';
import {
  canTransition,
  storyStream,
  taskStream,
  workEvents,
  type Actor,
  type ProjectWork,
  type Story,
  type Task,
  type TaskDetails,
  type TaskKind,
} from '@megalodon/contracts';
import { AppError } from '../errors';
import type { EventStore } from '../events/store';
import type { ProjectsQueries } from '../projects/projection';
import type { WorkQueries } from './projection';

const OPERATOR: Actor = { kind: 'operator' };

/** Stories, tasks and manual tasks, and every change of their status. */
export class WorkService {
  constructor(
    private readonly store: EventStore,
    readonly queries: WorkQueries,
    private readonly projects: ProjectsQueries,
  ) {}

  work(projectId: string): ProjectWork {
    this.project(projectId);
    return { stories: this.queries.stories(projectId), tasks: this.queries.tasks(projectId) };
  }

  details(taskId: string): TaskDetails {
    const task = this.task(taskId);
    const history = this.store.readStream(taskStream(taskId)).map(({ seq, type, at, actor, data }) => ({ seq, type, at, actor, data }));
    return { task, story: task.storyId ? this.queries.story(task.storyId) : null, history };
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
