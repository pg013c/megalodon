import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  runEvents,
  runStream,
  workEvents,
  zeroUsage,
  type Actor,
  type PlannedStep,
  type Project,
  type Run,
  type RunDetails,
  type RunMessage,
  type Task,
  type TimelineEntry,
  type Usage,
} from '@megalodon/contracts';
import { AppError } from '../errors';
import type { EventStore } from '../events/store';
import type { AgentLibrary } from '../library/agents';
import type { ProjectsQueries } from '../projects/projection';
import type { AgentRuntime } from '../runtime/types';
import type { WorkService } from '../work/service';
import { runCommand } from './command';
import { addWorktree, commitAll, revParse, taskBranch, worktreeExists } from './git';
import type { RunsQueries } from './projection';

const OPERATOR: Actor = { kind: 'operator' };
const SYSTEM: Actor = { kind: 'system' };

/** Statuses a task may be started from by the operator, before a scheduler exists (MVP step 3). */
const STARTABLE = new Set(['backlog', 'ready', 'failed', 'needs_you']);

const SETUP_TIMEOUT_MS = 15 * 60_000;

export interface RunServiceDeps {
  store: EventStore;
  runs: RunsQueries;
  work: WorkService;
  projects: ProjectsQueries;
  library: AgentLibrary;
  runtime: AgentRuntime;
  dataDir: string;
  /** Environment agents and commands run with; see `agentEnv`. */
  env: Record<string, string>;
}

interface Active {
  controller: AbortController;
  /** Why the run is being stopped, if it is. */
  stop: 'operator' | 'task_cancelled' | 'shutdown' | null;
  done: Promise<void>;
}

/**
 * Starts, executes, stops and recovers runs. A run works in its own worktree and follows the plan
 * fixed at its start; every step, message and usage report is an event in `run:<id>`.
 */
export class RunService {
  private readonly active = new Map<string, Active>();

  constructor(private readonly deps: RunServiceDeps) {
    // a task cancelled while its run works stops the run
    deps.store.subscribe((event) => {
      if (event.type !== workEvents.taskStatusChanged) return;
      const { id, to } = event.data as { id: string; to: string };
      if (to !== 'cancelled') return;
      for (const run of deps.runs.forTask(id)) if (run.status === 'running') this.abort(run.id, 'task_cancelled');
    });
  }

  details(runId: string): RunDetails {
    const run = this.run(runId);
    const timeline: TimelineEntry[] = this.deps.store
      .readStream(runStream(runId))
      .filter((e) => e.type === runEvents.stepMessage)
      .map((e) => {
        const data = e.data as { stepId: string; message: RunMessage };
        return { seq: e.seq, at: e.at, stepId: data.stepId, message: data.message };
      });
    return { run, steps: this.deps.runs.steps(runId), timeline };
  }

  forTask(taskId: string): Run[] {
    return this.deps.runs.forTask(taskId);
  }

  /** The operator starts an agent on a task: a new branch and worktree from the base branch. */
  async start(taskId: string, agentId: string): Promise<Run> {
    const task = this.task(taskId);
    if (task.kind !== 'task') throw new AppError(400, 'NOT_AN_AGENT_TASK', 'Manual tasks are done by you, not by agents');
    if (this.deps.runs.forTask(taskId).some((r) => r.status === 'running')) {
      throw new AppError(409, 'RUN_IN_PROGRESS', `#${task.number} already has a run in progress`);
    }
    if (!STARTABLE.has(task.status)) throw new AppError(409, 'INVALID_TRANSITION', `#${task.number} cannot start from ${task.status}`);
    const project = this.project(task.projectId);
    const agent = this.deps.library.get(agentId);

    const runId = randomUUID();
    const baseRef = project.settings.baseBranch;
    const baseSha = await revParse(project.path, `refs/heads/${baseRef}`);
    const branch = await taskBranch(project.path, task.number, task.title);
    const worktreePath = join(this.deps.dataDir, 'worktrees', project.id, runId);
    try {
      await addWorktree(project.path, worktreePath, branch, baseSha);
    } catch (error) {
      throw new AppError(500, 'WORKTREE_FAILED', `Could not create the worktree: ${(error as Error).message}`);
    }

    const plan: PlannedStep[] = [
      ...(project.settings.setup.length ? [{ kind: 'command' as const, stepId: 'setup', name: 'Setup', commands: project.settings.setup }] : []),
      { kind: 'agent' as const, stepId: 'agent', name: agent.name, agentId: agent.id },
    ];
    this.deps.store.append([
      {
        type: runEvents.started,
        stream: runStream(runId),
        data: { runId, taskId, projectId: project.id, agentId: agent.id, branch, worktreePath, baseRef, baseSha, plan },
        actor: OPERATOR,
      },
    ]);
    if (task.status === 'backlog' || task.status === 'failed') this.deps.work.transition(taskId, 'ready', 'Started by you', OPERATOR);
    this.deps.work.transition(taskId, 'running', `${agent.name} is working on ${branch}`, OPERATOR);

    this.launch(runId, null);
    return this.run(runId);
  }

  /** The operator stops a run; its task fails and can be retried. */
  stop(runId: string): Run {
    const run = this.run(runId);
    if (run.status !== 'running') throw new AppError(409, 'RUN_NOT_RUNNING', 'The run is not running');
    if (!this.abort(runId, 'operator')) this.complete(run, 'cancelled', null, 'Stopped by you');
    return this.run(runId);
  }

  /** On startup: continue runs a previous server left running, or fail them with the reason. */
  recover(): void {
    for (const run of this.deps.runs.running()) {
      if (this.active.has(run.id)) continue;
      if (!worktreeExists(run.worktreePath)) {
        this.complete(run, 'failed', null, 'The worktree disappeared while Megalodon was stopped');
        continue;
      }
      const current = this.deps.runs.steps(run.id).find((s) => s.status === 'running');
      this.deps.store.append([
        {
          type: runEvents.resumed,
          stream: runStream(run.id),
          data: { runId: run.id, stepId: current?.stepId ?? 'next', reason: 'Megalodon restarted while the run was working' },
          actor: SYSTEM,
        },
      ]);
      this.launch(run.id, current?.kind === 'agent' ? current.sessionId : null);
    }
  }

  /** Stops executing without recording an outcome, so the next start can recover the runs. */
  async shutdown(): Promise<void> {
    const pending = [...this.active.entries()].map(([id, active]) => {
      this.abort(id, 'shutdown');
      return active.done;
    });
    await Promise.all(pending);
  }

  /** Waits for every run executing now; for tests. */
  async idle(): Promise<void> {
    while (this.active.size > 0) await Promise.all([...this.active.values()].map((a) => a.done));
  }

  private abort(runId: string, reason: NonNullable<Active['stop']>): boolean {
    const active = this.active.get(runId);
    if (!active) return false;
    active.stop ??= reason;
    active.controller.abort();
    return true;
  }

  private launch(runId: string, resumeSessionId: string | null): void {
    const controller = new AbortController();
    const active: Active = { controller, stop: null, done: Promise.resolve() };
    this.active.set(runId, active);
    active.done = this.execute(runId, active, resumeSessionId)
      .catch((error: unknown) => {
        if (active.stop !== 'shutdown') this.complete(this.run(runId), 'failed', null, `Megalodon error: ${(error as Error).message}`);
      })
      .finally(() => this.active.delete(runId));
  }

  private async execute(runId: string, active: Active, resumeSessionId: string | null): Promise<void> {
    const run = this.run(runId);
    const task = this.task(run.taskId);
    const project = this.project(run.projectId);
    const done = new Set(this.deps.runs.steps(runId).filter((s) => s.status === 'succeeded').map((s) => s.stepId));
    const plan = this.deps.runs.plan(runId);

    for (const [index, step] of plan.entries()) {
      if (done.has(step.stepId)) continue;
      if (active.stop === 'shutdown') return;
      if (active.stop) {
        this.complete(run, 'cancelled', null, active.stop === 'operator' ? 'Stopped by you' : 'Task cancelled');
        return;
      }
      const outcome =
        step.kind === 'command'
          ? await this.commandStep(run, step, index, active)
          : await this.agentStep(run, step, index, active, task, project, resumeSessionId);
      resumeSessionId = null;
      if (active.stop === 'shutdown') return;
      if (outcome !== 'succeeded') {
        if (active.stop) this.complete(run, 'cancelled', null, active.stop === 'operator' ? 'Stopped by you' : 'Task cancelled');
        else this.complete(run, 'failed', null, `${step.name} failed`);
        return;
      }
    }

    const summary = this.deps.runs.steps(runId).find((s) => s.kind === 'agent')?.result ?? '';
    const sha = await commitAll(run.worktreePath, commitMessage(task, summary));
    this.complete(run, 'succeeded', sha, null);
  }

  private async commandStep(run: Run, step: Extract<PlannedStep, { kind: 'command' }>, index: number, active: Active) {
    this.stepStarted(run.id, step.stepId, index, 'command', step.name, null, null);
    const started = Date.now();
    for (const command of step.commands) {
      const result = await runCommand(command, {
        cwd: run.worktreePath,
        env: this.deps.env,
        timeoutMs: SETUP_TIMEOUT_MS,
        logPath: join(this.deps.dataDir, 'logs', run.id, `${step.stepId}.log`),
        signal: active.controller.signal,
      });
      if (active.stop === 'shutdown') return 'cancelled';
      this.message(run.id, step.stepId, { kind: 'output', text: `$ ${command}\n${result.tail}` });
      if (result.exitCode !== 0) {
        const why = result.aborted ? 'stopped' : result.timedOut ? 'timed out' : `exit code ${result.exitCode}`;
        this.stepCompleted(run.id, step.stepId, active.stop ? 'cancelled' : 'failed', zeroUsage, Date.now() - started, null, null, `\`${command}\` ${why}`);
        return 'failed';
      }
    }
    this.stepCompleted(run.id, step.stepId, 'succeeded', zeroUsage, Date.now() - started, null, null, null);
    return 'succeeded';
  }

  private async agentStep(
    run: Run,
    step: Extract<PlannedStep, { kind: 'agent' }>,
    index: number,
    active: Active,
    task: Task,
    project: Project,
    resumeSessionId: string | null,
  ) {
    const agent = this.deps.library.get(step.agentId);
    if (!resumeSessionId) this.stepStarted(run.id, step.stepId, index, 'agent', step.name, agent.id, agent.version);
    const prompt = resumeSessionId
      ? 'Megalodon was restarted while you were working on this task. Check the state of the working directory, continue from where you stopped and finish the task.'
      : taskPrompt(task, project, run.branch);

    for await (const event of this.deps.runtime.run({
      agent,
      cwd: run.worktreePath,
      prompt,
      env: this.deps.env,
      signal: active.controller.signal,
      ...(resumeSessionId ? { resumeSessionId } : {}),
    })) {
      if (active.stop === 'shutdown') return 'cancelled';
      if (event.type === 'session') this.append(run.id, runEvents.stepSession, { runId: run.id, stepId: step.stepId, sessionId: event.sessionId });
      if (event.type === 'message') this.message(run.id, step.stepId, event.message);
      if (event.type === 'result') {
        const status = event.ok ? 'succeeded' : active.stop ? 'cancelled' : 'failed';
        this.stepCompleted(run.id, step.stepId, status, event.usage, event.durationMs, event.numTurns, event.result, event.error);
        return status;
      }
    }
    return 'failed';
  }

  /** Records the outcome and moves the task on, if it is still the run's to move. */
  private complete(run: Run, status: 'succeeded' | 'failed' | 'cancelled', commitSha: string | null, error: string | null): void {
    this.append(run.id, runEvents.completed, { runId: run.id, status, commitSha, error });
    const task = this.task(run.taskId);
    if (task.status !== 'running') return; // e.g. the task was cancelled
    if (status === 'succeeded') {
      const reason = commitSha ? `Review ${run.branch}` : 'The agent finished without changing any files';
      this.deps.work.transition(task.id, 'needs_you', reason, SYSTEM);
    } else {
      this.deps.work.transition(task.id, 'failed', error ?? 'The run failed', SYSTEM);
    }
  }

  private stepStarted(runId: string, stepId: string, index: number, kind: 'command' | 'agent', name: string, agentId: string | null, agentVersion: string | null) {
    this.append(runId, runEvents.stepStarted, { runId, stepId, index, kind, name, agentId, agentVersion });
  }

  private stepCompleted(
    runId: string,
    stepId: string,
    status: 'succeeded' | 'failed' | 'cancelled',
    usage: Usage,
    durationMs: number,
    numTurns: number | null,
    result: string | null,
    error: string | null,
  ) {
    this.append(runId, runEvents.stepCompleted, { runId, stepId, status, usage, durationMs: Math.round(durationMs), numTurns, result, error });
  }

  private message(runId: string, stepId: string, message: RunMessage) {
    this.append(runId, runEvents.stepMessage, { runId, stepId, message });
  }

  private append(runId: string, type: string, data: unknown) {
    this.deps.store.append([{ type, stream: runStream(runId), data, actor: SYSTEM }]);
  }

  private run(id: string): Run {
    const run = this.deps.runs.run(id);
    if (!run) throw new AppError(404, 'RUN_NOT_FOUND', `No run ${id}`);
    return run;
  }

  private task(id: string): Task {
    const task = this.deps.work.queries.task(id);
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', `No task ${id}`);
    return task;
  }

  private project(id: string): Project {
    const project = this.deps.projects.get(id);
    if (!project) throw new AppError(404, 'PROJECT_NOT_FOUND', `No project ${id}`);
    return project;
  }
}

export function taskPrompt(task: Task, project: Project, branch: string): string {
  const checks = project.settings.checks.map((c) => `- ${c.name}: \`${c.command}\``).join('\n');
  return [
    `Task #${task.number} in ${project.name}: ${task.title}`,
    '',
    task.description.trim() || '(No description beyond the title.)',
    '',
    `You are in a git worktree on the branch \`${branch}\`, created from \`${project.settings.baseBranch}\`.`,
    checks ? `The project's checks:\n${checks}` : 'The project has no configured checks.',
  ].join('\n');
}

function commitMessage(task: Task, summary: string): string {
  const body = summary.trim().slice(0, 4_000);
  return `#${task.number} ${task.title}${body ? `\n\n${body}` : ''}`;
}

/**
 * The environment agents and commands get: the server's own, minus credentials Megalodon uses for
 * its integrations, which agents must not inherit (ADR-0010).
 */
export function agentEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const hidden = /^(AWS_|MEGALODON_|GITHUB_TOKEN$|GH_TOKEN$|GH_ENTERPRISE_TOKEN$|BITBUCKET_)/;
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !hidden.test(entry[0])),
  );
}
