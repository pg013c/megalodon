import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  decisionEvents,
  outputContracts,
  type StoredEvent,
  taskStream,
  workEvents,
  type Actor,
  type NewEvent,
  type Task,
  type TriageOutput,
} from '@megalodon/contracts';
import type { DecisionService } from '../decisions/service';
import { AppError } from '../errors';
import type { EventStore } from '../events/store';
import type { Library } from '../library/library';
import type { ProjectsQueries } from '../projects/projection';
import { addDetachedWorktree, removeWorktree, revParse } from '../runs/git';
import type { AgentRuntime } from '../runtime/types';
import type { WorkService } from '../work/service';
import { triagePrompt } from './prompt';

const SYSTEM: Actor = { kind: 'system' };

export interface TriageDeps {
  store: EventStore;
  work: WorkService;
  decisions: DecisionService;
  projects: ProjectsQueries;
  library: Library;
  runtime: AgentRuntime;
  dataDir: string;
  env: Record<string, string>;
  /** Triage every new task by itself (off in tests that do not want it). */
  auto: boolean;
}

/**
 * The triage lane (ARCHITECTURE §6): one task at a time, outside the slot pool. The triage agent
 * reads the base branch and the open work; its answer becomes the task's touch-set, pipeline,
 * dependencies and manual tasks, and the task joins the queue.
 */
export class TriageService {
  private working: Promise<void> | null = null;

  constructor(private readonly deps: TriageDeps) {
    deps.store.subscribe((event) => this.onOverride(event));
    if (deps.auto) {
      deps.store.subscribe((event) => {
        if (event.type !== workEvents.taskCreated) return;
        const data = event.data as { id: string; kind: string };
        // tasks the triage itself creates are manual, so this never loops
        if (data.kind === 'task' && event.actor.kind === 'operator') queueMicrotask(() => this.request(data.id, SYSTEM));
      });
    }
  }

  /** The operator lets a held task into the queue by overriding the queue decision. */
  private onOverride(event: StoredEvent): void {
    if (event.type !== decisionEvents.made || event.actor.kind !== 'operator') return;
    const d = event.data as { taskId: string; kind: string; outcome: string; overrides: string | null };
    if (d.overrides && d.kind === 'queue' && d.outcome === 'queue' && this.deps.work.queries.task(d.taskId)?.status === 'backlog') {
      this.deps.work.transition(d.taskId, 'ready', 'Queued by you', event.actor);
    }
  }

  /** Asks for (another) triage of a task in the backlog. */
  request(taskId: string, actor: Actor = { kind: 'operator' }): void {
    const task = this.deps.work.queries.task(taskId);
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', `No task ${taskId}`);
    if (task.kind !== 'task') throw new AppError(400, 'NOT_AN_AGENT_TASK', 'Manual tasks are not triaged');
    if (task.status !== 'backlog') throw new AppError(409, 'NOT_IN_BACKLOG', `#${task.number} is already past triage`);
    if (task.triage === 'pending' || task.triage === 'running') return;
    this.deps.store.append([{ type: workEvents.triageRequested, stream: taskStream(taskId), data: { taskId }, actor }]);
    this.kick();
  }

  /** On startup: triage what was waiting or interrupted. */
  recover(): void {
    if (this.deps.work.queries.awaitingTriage().length) this.kick();
  }

  /** Resolves when the lane is empty; for tests. */
  async idle(): Promise<void> {
    while (this.working) await this.working;
  }

  private kick(): void {
    if (this.working) return;
    this.working = (async () => {
      for (let task = this.next(); task; task = this.next()) await this.triage(task);
    })().finally(() => {
      this.working = null;
    });
  }

  private next(): Task | undefined {
    return this.deps.work.queries.awaitingTriage().find((t) => t.status === 'backlog');
  }

  private async triage(task: Task): Promise<void> {
    this.deps.store.append([{ type: workEvents.triageStarted, stream: taskStream(task.id), data: { taskId: task.id }, actor: SYSTEM }]);
    const spent = { costUsd: 0, durationMs: 0 };
    try {
      const output = await this.ask(task, spent);
      this.apply(this.deps.work.queries.task(task.id)!, output, spent);
    } catch (error) {
      this.deps.store.append([
        { type: workEvents.triageFailed, stream: taskStream(task.id), data: { taskId: task.id, error: (error as Error).message, ...spent }, actor: SYSTEM },
      ]);
    }
  }

  private async ask(task: Task, spent: { costUsd: number; durationMs: number }): Promise<TriageOutput> {
    const project = this.deps.projects.get(task.projectId);
    if (!project) throw new Error('The project is gone');
    const agent = this.deps.library.agent('triage');
    const sha = await revParse(project.path, `refs/heads/${project.settings.baseBranch}`);
    const cwd = join(this.deps.dataDir, 'triage', `${task.id}-${randomUUID().slice(0, 8)}`);
    await addDetachedWorktree(project.path, cwd, sha);
    try {
      const prompt = triagePrompt(task, project, this.deps.work.queries.tasks(project.id), this.deps.work.queries.stories(project.id), this.deps.library.pipelines());
      for await (const event of this.deps.runtime.run({ agent, cwd, prompt, env: this.deps.env, signal: new AbortController().signal })) {
        if (event.type !== 'result') continue;
        spent.costUsd = event.usage.costUsd;
        spent.durationMs = Math.round(event.durationMs);
        if (!event.ok) throw new Error(event.error ?? 'The triage agent failed');
        const parsed = outputContracts.triage.safeParse(event.output);
        if (!parsed.success) throw new Error(`The triage agent answered without a valid triage (${parsed.error.issues[0]?.message ?? 'invalid'})`);
        return parsed.data;
      }
      throw new Error('The triage agent ended without a result');
    } finally {
      await removeWorktree(project.path, cwd).catch(() => undefined);
    }
  }

  /** Records the triage and its effects in one append, then queues the task. */
  private apply(task: Task, output: TriageOutput, spent: { costUsd: number; durationMs: number }): void {
    const agent = this.deps.library.agent('triage');
    const actor: Actor = { kind: 'agent', agentId: agent.id, version: agent.version };
    const pipelines = this.deps.library.pipelines().map((p) => p.id);
    const pipelineId = pipelines.includes(output.pipeline) ? output.pipeline : task.pipelineId;
    const notes: string[] = [];
    if (pipelineId !== output.pipeline) notes.push(`Unknown pipeline "${output.pipeline}"; kept ${pipelineId}.`);

    const events: NewEvent[] = [
      this.deps.decisions.event({
        taskId: task.id,
        runId: null,
        stepId: null,
        kind: 'triage',
        outcome: 'triaged',
        rationale: output.summary,
        alternatives: [],
        inputs: { ...output, notes },
        actor,
      }),
      { type: workEvents.taskTouchesSet, stream: taskStream(task.id), data: { id: task.id, touches: output.touches }, actor },
      { type: workEvents.taskPipelineSet, stream: taskStream(task.id), data: { id: task.id, pipelineId }, actor },
    ];

    let number = this.deps.work.queries.nextNumber(task.projectId);
    for (const manual of output.manualTasks) {
      const id = randomUUID();
      events.push(
        {
          type: workEvents.taskCreated,
          stream: taskStream(id),
          data: { id, projectId: task.projectId, number: number++, kind: 'manual', storyId: task.storyId, title: manual.title, description: manual.description },
          actor,
        },
        {
          type: workEvents.dependencyAdded,
          stream: taskStream(task.id),
          data: { id: randomUUID(), taskId: task.id, kind: 'manual', target: { type: 'task', id }, description: manual.reason, command: null },
          actor,
        },
      );
    }
    for (const dependency of output.dependsOn) {
      const target = this.deps.work.queries.byNumber(task.projectId, dependency.number);
      if (!target) {
        notes.push(`#${dependency.number} does not exist; ignored.`);
        continue;
      }
      try {
        events.push(this.deps.work.dependencyEvent(task.id, { kind: 'code', target, description: dependency.reason, command: null }, actor));
      } catch (error) {
        notes.push(`Dependency on #${dependency.number} ignored: ${(error as Error).message}`);
      }
    }
    events.push({ type: workEvents.triageCompleted, stream: taskStream(task.id), data: { taskId: task.id, summary: output.summary, ...spent }, actor });
    const queue = queueDecision(this.deps.projects.get(task.projectId)?.settings.policies.queue.mode ?? 'auto', output.manualTasks.length);
    events.push(
      this.deps.decisions.event({
        taskId: task.id,
        runId: null,
        stepId: null,
        kind: 'queue',
        outcome: queue.outcome,
        rationale: queue.rationale,
        alternatives: ['queue', 'hold'],
        actor: { kind: 'policy', policy: 'policy:queue' },
      }),
    );
    this.deps.store.append(events);

    // the scheduler decides between ready and blocked
    if (queue.outcome === 'queue' && this.deps.work.queries.task(task.id)?.status === 'backlog') {
      this.deps.work.transition(task.id, 'ready', 'Triaged', actor);
    }
  }
}

/** The queue gate (ADR-0028): after triage, queue the task or hold it for the operator. */
export function queueDecision(mode: 'auto' | 'auto_if' | 'operator', manualTasks: number) {
  if (mode === 'operator') return { outcome: 'hold', rationale: 'The project asks you before queueing triaged tasks.' };
  if (mode === 'auto_if' && manualTasks > 0) {
    return { outcome: 'hold', rationale: `Triage found ${manualTasks} manual ${manualTasks === 1 ? 'task' : 'tasks'}; the project asks you before queueing such tasks.` };
  }
  return { outcome: 'queue', rationale: 'Queued after triage.' };
}
