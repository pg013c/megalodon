import {
  runEvents,
  SCHEDULER_STREAM,
  schedulerEvents,
  type Actor,
  type MergeBlock,
  type QueueEntry,
  type QueueView,
  type Requirement,
  type SchedulerState,
  type Task,
} from '@megalodon/contracts';
import type { EventStore } from '../events/store';
import { revParse } from '../runs/git';
import type { ProjectsQueries } from '../projects/projection';
import type { RunsQueries } from '../runs/projection';
import { runCommand } from '../runs/command';
import { PLAN_LIMIT, type RunService } from '../runs/service';
import type { WorkService } from '../work/service';
import { requirementsOf, touchesOverlap } from '../work/readiness';
import type { SchedulerQueries } from './projection';

const SCHEDULER: Actor = { kind: 'policy', policy: 'scheduler' };
const OPERATOR: Actor = { kind: 'operator' };
const PLAN_LIMIT_PAUSE_MS = 30 * 60_000;
const EXTERNAL_CHECK_EVERY_MS = 60_000;
const TICK_EVERY_MS = 15_000;

export interface SchedulerDeps {
  store: EventStore;
  queries: SchedulerQueries;
  work: WorkService;
  runs: RunService;
  runsQueries: RunsQueries;
  projects: ProjectsQueries;
  /** Where commands of external dependencies log. */
  logDir: string;
  now?: () => Date;
  /** Projects whose merges wait for the operator's checkout, for the queue view. */
  mergeBlocks?: () => MergeBlock[];
}

/**
 * The global queue (CONCEPTS.md §5, ADR-0007): keeps `ready`/`blocked` in step with dependencies,
 * starts the oldest ready tasks into free slots, skips collisions and capped projects, and pauses
 * when the plan's limit is reached.
 */
export class Scheduler {
  private readonly now: () => Date;
  private ticking: Promise<void> | null = null;
  private again = false;
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly externalCheckedAt = new Map<string, number>();

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? (() => new Date());
    deps.work.setExtraRequirements((task) => this.collisions(task));
    // a run the plan's limit stopped pauses the queue
    deps.store.subscribe((event) => {
      if (event.type !== runEvents.completed) return;
      const error = (event.data as { error: string | null }).error;
      if (error?.startsWith(PLAN_LIMIT) && this.state().paused === null) {
        const until = new Date(this.now().getTime() + PLAN_LIMIT_PAUSE_MS).toISOString();
        deps.store.append([{ type: schedulerEvents.paused, stream: SCHEDULER_STREAM, data: { reason: 'plan_limit', until, detail: error }, actor: SCHEDULER }]);
      }
    });
  }

  /** Ticks on every relevant change and every few seconds. */
  start(): void {
    this.unsubscribe = this.deps.store.subscribe((event) => {
      if (event.type.startsWith('task.') || event.type.startsWith('dependency.') || event.type === runEvents.completed || event.type.startsWith('scheduler.')) {
        queueMicrotask(() => void this.tick());
      }
    });
    this.timer = setInterval(() => void this.tick(), TICK_EVERY_MS);
    void this.tick();
  }

  stop(): void {
    this.unsubscribe?.();
    if (this.timer) clearInterval(this.timer);
  }

  state(): SchedulerState {
    return this.deps.queries.state();
  }

  setSlots(slots: number): SchedulerState {
    this.deps.store.append([{ type: schedulerEvents.slotsSet, stream: SCHEDULER_STREAM, data: { slots }, actor: OPERATOR }]);
    return this.state();
  }

  pause(): SchedulerState {
    if (this.state().paused === 'operator') return this.state();
    this.deps.store.append([{ type: schedulerEvents.paused, stream: SCHEDULER_STREAM, data: { reason: 'operator', until: null, detail: null }, actor: OPERATOR }]);
    return this.state();
  }

  resume(actor: Actor = OPERATOR): SchedulerState {
    if (this.state().paused === null) return this.state();
    this.deps.store.append([{ type: schedulerEvents.resumed, stream: SCHEDULER_STREAM, data: {}, actor }]);
    this.requeueLimited();
    return this.state();
  }

  view(): QueueView {
    const entry = (task: Task, waitingFor: Requirement[] = []): QueueEntry => ({
      task,
      projectName: this.deps.projects.get(task.projectId)?.name ?? '',
      runId: this.deps.runsQueries.forTask(task.id).find((r) => r.status === 'running')?.id ?? null,
      waitingFor,
    });
    return {
      state: this.state(),
      running: this.deps.work.queries.inStatus(['running', 'merging']).map((t) => entry(t)),
      waiting: this.deps.work.queries
        .inStatus(['ready', 'blocked'])
        .filter((t) => t.kind === 'task')
        .map((t) => entry(t, this.deps.work.requirements(t).filter((r) => !r.met))),
      mergeBlocked: this.deps.mergeBlocks?.() ?? [],
    };
  }

  /** One pass; concurrent calls share it, and a call during a pass runs one more. */
  tick(): Promise<void> {
    if (this.ticking) {
      this.again = true;
      return this.ticking;
    }
    this.ticking = (async () => {
      do {
        this.again = false;
        await this.pass();
      } while (this.again);
    })().finally(() => {
      this.ticking = null;
    });
    return this.ticking;
  }

  private async pass(): Promise<void> {
    await this.checkExternals();
    this.reconcile();
    const state = this.state();
    if (state.paused === 'plan_limit' && state.pausedUntil && new Date(state.pausedUntil) <= this.now()) this.resume(SCHEDULER);
    if (this.state().paused) return;

    let running = this.deps.runsQueries.running();
    for (const task of this.deps.work.queries.inStatus(['ready'])) {
      if (task.kind !== 'task') continue;
      if (running.length >= this.state().slots) return;
      const project = this.deps.projects.get(task.projectId);
      if (!project) continue;
      const cap = project.settings.maxParallel;
      if (cap !== null && running.filter((r) => r.projectId === project.id).length >= cap) continue;
      if (this.collisions(task).length) continue;

      // revalidate right before the start: the base branch and every dependency, as they are now
      const unmet = requirementsOf(task, this.deps.work.queries).filter((r) => !r.met);
      if (unmet.length) {
        this.deps.work.transition(task.id, 'blocked', waitingReason(unmet), SCHEDULER);
        continue;
      }
      try {
        await revParse(project.path, `refs/heads/${project.settings.baseBranch}`);
        await this.deps.runs.start(task.id, { pipelineId: task.pipelineId }, SCHEDULER);
      } catch (error) {
        const current = this.deps.work.queries.task(task.id);
        if (current?.status === 'ready') this.deps.work.transition(task.id, 'blocked', `Cannot start: ${(error as Error).message}`, SCHEDULER);
      }
      running = this.deps.runsQueries.running();
    }
  }

  /** `ready` when every dependency is met, `blocked` otherwise (collisions only delay the start). */
  private reconcile(): void {
    for (const task of this.deps.work.queries.inStatus(['ready', 'blocked'])) {
      if (task.kind !== 'task') continue;
      const unmet = requirementsOf(task, this.deps.work.queries).filter((r) => !r.met);
      if (unmet.length && task.status === 'ready') this.deps.work.transition(task.id, 'blocked', waitingReason(unmet), SCHEDULER);
      if (!unmet.length && task.status === 'blocked') this.deps.work.transition(task.id, 'ready', 'Everything it needs is in place', SCHEDULER);
    }
  }

  /** Runs the operator's commands of unmet external dependencies, at most once a minute each. */
  private async checkExternals(): Promise<void> {
    for (const task of this.deps.work.queries.inStatus(['blocked'])) {
      const project = this.deps.projects.get(task.projectId);
      if (!project) continue;
      for (const dependency of this.deps.work.queries.dependencies(task.id)) {
        if (dependency.kind !== 'external' || dependency.met || !dependency.command) continue;
        const last = this.externalCheckedAt.get(dependency.id) ?? 0;
        if (this.now().getTime() - last < EXTERNAL_CHECK_EVERY_MS) continue;
        this.externalCheckedAt.set(dependency.id, this.now().getTime());
        const result = await runCommand(dependency.command, {
          cwd: project.path,
          env: process.env,
          timeoutMs: 30_000,
          logPath: `${this.deps.logDir}/external-${dependency.id}.log`,
          signal: new AbortController().signal,
        });
        if (result.exitCode === 0) this.deps.work.markMet(dependency.id, { kind: 'policy', policy: 'external-check' });
      }
    }
  }

  /** Running or merging tasks whose touch-set overlaps this one's (CONCEPTS.md §4). */
  private collisions(task: Task): Requirement[] {
    if (task.kind !== 'task' || !['ready', 'blocked'].includes(task.status) || !task.touches.length) return [];
    return this.deps.work.queries
      .inStatus(['running', 'merging'])
      .filter((other) => other.projectId === task.projectId && other.id !== task.id && touchesOverlap(task.touches, other.touches))
      .map((other) => ({
        kind: 'collision' as const,
        label: `#${other.number} ${other.title} is changing the same files`,
        met: false,
        dependencyId: null,
        ref: { type: 'task' as const, id: other.id, number: other.number },
      }));
  }

  /** Tasks the plan limit failed go back to the queue when the pause ends. */
  private requeueLimited(): void {
    for (const task of this.deps.work.queries.inStatus(['failed'])) {
      if (task.statusReason?.startsWith(PLAN_LIMIT)) this.deps.work.transition(task.id, 'ready', 'Back in the queue after the plan limit', SCHEDULER);
    }
  }
}

export function waitingReason(unmet: readonly Requirement[]): string {
  return `Waits for ${unmet.map((r) => r.label).join(', ')}`;
}
