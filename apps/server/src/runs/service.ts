import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  decisionEvents,
  outputContracts,
  runEvents,
  runStream,
  workEvents,
  zeroUsage,
  type Actor,
  type Agent,
  type NewEvent,
  type PlannedStep,
  type PlanOutput,
  type Project,
  type ReviewOutput,
  type Run,
  type RunDetails,
  type RunMessage,
  type Task,
  type TimelineEntry,
  type Usage,
} from '@megalodon/contracts';
import type { DecisionService } from '../decisions/service';
import { AppError } from '../errors';
import type { EventStore } from '../events/store';
import type { Library } from '../library/library';
import type { ProjectsQueries } from '../projects/projection';
import type { AgentRuntime } from '../runtime/types';
import type { WorkService } from '../work/service';
import { runCommand } from './command';
import { addWorktree, branchDiff, commitAll, head, revParse, taskBranch, worktreeExists } from './git';
import { buildPlan, runPosition, type RunPosition } from './plan';
import type { RunsQueries } from './projection';
import { fixPrompt, implementationPrompt, planningPrompt, resumePrompt, reviewFeedback, reviewPrompt, taskPrompt } from './prompts';

const OPERATOR: Actor = { kind: 'operator' };
const SYSTEM: Actor = { kind: 'system' };

/** Statuses a task may be started from by the operator, before a scheduler exists. */
const STARTABLE = new Set(['backlog', 'ready', 'failed', 'needs_you']);

const SETUP_TIMEOUT_MS = 15 * 60_000;

export interface RunServiceDeps {
  store: EventStore;
  runs: RunsQueries;
  work: WorkService;
  decisions: DecisionService;
  projects: ProjectsQueries;
  library: Library;
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

/** How one step attempt ended, for the flow of the run. */
type StepOutcome =
  | { kind: 'passed' }
  /** Checks failed or a gate said no: the step's onFail rule decides. */
  | { kind: 'rejected'; feedback: string; events: NewEvent[] }
  | { kind: 'error'; error: string }
  | { kind: 'stopped' };

/** How a finished run leaves its task. */
type Ending =
  | { status: 'succeeded'; reason: string; commitSha: string | null }
  /** `needs_you`: the run produced something to look at, but checks or review never passed. */
  | { status: 'failed'; error: string; taskTo: 'needs_you' | 'failed'; commitSha?: string | null }
  | { status: 'cancelled'; error: string };

/**
 * Starts, executes, stops and recovers runs. A run follows the plan fixed at its start (its
 * pipeline); every step attempt, message, usage report and decision is an event in `run:<id>`.
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
    const decisions = new Map(this.deps.decisions.queries.forRun(runId).map((d) => [d.id, d]));
    const timeline: TimelineEntry[] = [];
    for (const e of this.deps.store.readStream(runStream(runId))) {
      if (e.type === runEvents.stepMessage) {
        const data = e.data as { stepId: string; message: RunMessage };
        timeline.push({ seq: e.seq, at: e.at, stepId: data.stepId, item: { type: 'message', message: data.message } });
      } else if (e.type === decisionEvents.made) {
        const decision = decisions.get((e.data as { id: string }).id);
        if (decision) timeline.push({ seq: e.seq, at: e.at, stepId: decision.stepId, item: { type: 'decision', decision } });
      }
    }
    return { run, plan: this.deps.runs.plan(runId), steps: this.deps.runs.steps(runId), timeline };
  }

  forTask(taskId: string): Run[] {
    return this.deps.runs.forTask(taskId);
  }

  /** The operator starts a pipeline (or one agent) on a task: a new branch and worktree from the base. */
  async start(taskId: string, source: { pipelineId: string } | { agentId: string }): Promise<Run> {
    const task = this.task(taskId);
    if (task.kind !== 'task') throw new AppError(400, 'NOT_AN_AGENT_TASK', 'Manual tasks are done by you, not by agents');
    if (this.deps.runs.forTask(taskId).some((r) => r.status === 'running')) {
      throw new AppError(409, 'RUN_IN_PROGRESS', `#${task.number} already has a run in progress`);
    }
    if (!STARTABLE.has(task.status)) throw new AppError(409, 'INVALID_TRANSITION', `#${task.number} cannot start from ${task.status}`);
    const project = this.project(task.projectId);
    const { pipelineId, pipelineVersion, plan } = buildPlan(source, project, this.deps.library);

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

    this.deps.store.append([
      {
        type: runEvents.started,
        stream: runStream(runId),
        data: { runId, taskId, projectId: project.id, pipelineId, pipelineVersion, branch, worktreePath, baseRef, baseSha, plan },
        actor: OPERATOR,
      },
    ]);
    if (task.status === 'backlog' || task.status === 'failed') this.deps.work.transition(taskId, 'ready', 'Started by you', OPERATOR);
    this.deps.work.transition(taskId, 'running', `Running ${pipelineId} on ${branch}`, OPERATOR);

    this.launch(runId, false);
    return this.run(runId);
  }

  /** The operator stops a run; its task fails and can be retried. */
  stop(runId: string): Run {
    const run = this.run(runId);
    if (run.status !== 'running') throw new AppError(409, 'RUN_NOT_RUNNING', 'The run is not running');
    if (!this.abort(runId, 'operator')) this.finish(run, { status: 'cancelled', error: 'Stopped by you' });
    return this.run(runId);
  }

  /** On startup: continue runs a previous server left running, or fail them with the reason. */
  recover(): void {
    for (const run of this.deps.runs.running()) {
      if (this.active.has(run.id)) continue;
      if (!worktreeExists(run.worktreePath)) {
        this.finish(run, { status: 'failed', error: 'The worktree disappeared while Megalodon was stopped', taskTo: 'failed' });
        continue;
      }
      const position = runPosition(this.deps.store.readStream(runStream(run.id)), this.deps.runs.plan(run.id));
      this.append(run.id, runEvents.resumed, {
        runId: run.id,
        stepId: position.inProgress?.stepId ?? this.deps.runs.plan(run.id)[position.index]?.stepId ?? 'end',
        reason: 'Megalodon restarted while the run was working',
      });
      this.launch(run.id, true);
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

  private launch(runId: string, recovering: boolean): void {
    const active: Active = { controller: new AbortController(), stop: null, done: Promise.resolve() };
    this.active.set(runId, active);
    active.done = this.execute(runId, active, recovering)
      .catch((error: unknown) => {
        if (active.stop !== 'shutdown') {
          this.finish(this.run(runId), { status: 'failed', error: `Megalodon error: ${(error as Error).message}`, taskTo: 'failed' });
        }
      })
      .finally(() => this.active.delete(runId));
  }

  private async execute(runId: string, active: Active, recovering: boolean): Promise<void> {
    const run = this.run(runId);
    const task = this.task(run.taskId);
    const project = this.project(run.projectId);
    const plan = this.deps.runs.plan(runId);
    const position = runPosition(this.deps.store.readStream(runStream(runId)), plan);
    // an agent attempt interrupted by a restart continues its session; anything else starts over
    let resume = recovering && position.inProgress?.sessionId ? position.inProgress : null;

    while (position.index < plan.length) {
      if (active.stop === 'shutdown') return;
      if (active.stop) return this.finish(run, stopped(active));
      const step = plan[position.index]!;
      const attempt = resume?.stepId === step.stepId ? resume.attempt : (position.attempts.get(step.stepId) ?? 0) + 1;
      const outcome =
        step.kind === 'command'
          ? await this.commandStep(run, step, attempt, position.index, active)
          : step.kind === 'check'
            ? await this.checkStep(run, step, attempt, position.index, active)
            : await this.agentStep(run, step, attempt, position, active, task, project, resume?.stepId === step.stepId ? resume.sessionId : null);
      resume = null;
      if (active.stop === 'shutdown') return;
      if (outcome.kind === 'stopped') return this.finish(run, stopped(active));
      if (outcome.kind === 'error') return this.finish(run, { status: 'failed', error: outcome.error, taskTo: 'failed' });

      if (step.kind === 'agent') await commitAll(run.worktreePath, commitMessage(task, step, attempt, this.lastResult(runId, step.stepId)));

      if (outcome.kind === 'rejected') {
        const rule = step.kind === 'command' ? null : step.onFail;
        const used = position.retries.get(step.stepId) ?? 0;
        if (rule && used < rule.max) {
          this.deps.store.append([
            ...outcome.events,
            this.deps.decisions.event({
              taskId: task.id,
              runId,
              stepId: step.stepId,
              kind: 'retry',
              outcome: `retry ${rule.retry}`,
              rationale: `${step.name} did not pass; retry ${used + 1} of ${rule.max}.`,
              alternatives: [`retry ${rule.retry}`, 'stop'],
              inputs: { next: rule.retry, feedback: outcome.feedback, attempt: used + 1, max: rule.max },
              actor: { kind: 'policy', policy: `pipeline:${run.pipelineId}` },
            }),
          ]);
        } else {
          this.deps.store.append([
            ...outcome.events,
            this.deps.decisions.event({
              taskId: task.id,
              runId,
              stepId: step.stepId,
              kind: 'retry',
              outcome: 'stop',
              rationale: rule ? `${step.name} still did not pass after ${rule.max} ${rule.max === 1 ? 'retry' : 'retries'}.` : `${step.name} did not pass and the pipeline has no retry for it.`,
              alternatives: rule ? [`retry ${rule.retry}`, 'stop'] : ['stop'],
              inputs: { feedback: outcome.feedback },
              actor: { kind: 'policy', policy: `pipeline:${run.pipelineId}` },
            }),
          ]);
          return this.finish(run, { status: 'failed', error: `${step.name} did not pass`, taskTo: 'needs_you', commitSha: await this.commitSha(run) });
        }
        Object.assign(position, runPosition(this.deps.store.readStream(runStream(runId)), plan));
        continue;
      }
      Object.assign(position, runPosition(this.deps.store.readStream(runStream(runId)), plan));
    }

    const gate = this.deps.decisions.queries.effective(runId, 'gate');
    const commitSha = await this.commitSha(run);
    const reason = !commitSha
      ? 'The run finished without changing any files'
      : gate
        ? `${gate.rationale} Review ${run.branch}.`
        : `Review ${run.branch}`;
    this.finish(run, { status: 'succeeded', reason, commitSha });
  }

  /** The branch's last commit, or null when the run committed nothing. */
  private async commitSha(run: Run): Promise<string | null> {
    const sha = await head(run.worktreePath);
    return sha === run.baseSha ? null : sha;
  }

  private lastResult(runId: string, stepId: string): string {
    return this.deps.runs.steps(runId).filter((s) => s.stepId === stepId).at(-1)?.result ?? '';
  }

  private async commandStep(run: Run, step: Extract<PlannedStep, { kind: 'command' }>, attempt: number, index: number, active: Active): Promise<StepOutcome> {
    this.stepStarted(run.id, step.stepId, attempt, index, 'command', step.name, null, null);
    const started = Date.now();
    for (const command of step.commands) {
      const result = await this.command(run, step.stepId, command, SETUP_TIMEOUT_MS, active);
      if (active.stop === 'shutdown') return { kind: 'stopped' };
      this.message(run.id, step.stepId, attempt, { kind: 'output', text: `$ ${command}\n${result.tail}` });
      if (result.exitCode !== 0) {
        const why = result.aborted ? 'stopped' : result.timedOut ? 'timed out' : `exit code ${result.exitCode}`;
        this.append(run.id, runEvents.stepCompleted, completed(run.id, step.stepId, attempt, active.stop ? 'cancelled' : 'failed', zeroUsage, Date.now() - started, null, null, `\`${command}\` ${why}`));
        return active.stop ? { kind: 'stopped' } : { kind: 'error', error: `${step.name} failed` };
      }
    }
    this.append(run.id, runEvents.stepCompleted, completed(run.id, step.stepId, attempt, 'succeeded', zeroUsage, Date.now() - started, null, null, null));
    return { kind: 'passed' };
  }

  /** Runs the project's checks; required ones decide. Megalodon runs them, not an agent (ADR-0015). */
  private async checkStep(run: Run, step: Extract<PlannedStep, { kind: 'check' }>, attempt: number, index: number, active: Active): Promise<StepOutcome> {
    this.stepStarted(run.id, step.stepId, attempt, index, 'check', step.name, null, null);
    const started = Date.now();
    const failures: string[] = [];
    const lines: string[] = [];
    for (const check of step.checks) {
      const result = await this.command(run, step.stepId, check.command, check.timeoutSec * 1000, active);
      if (active.stop) {
        if (active.stop !== 'shutdown') {
          this.append(run.id, runEvents.stepCompleted, completed(run.id, step.stepId, attempt, 'cancelled', zeroUsage, Date.now() - started, null, null, 'Stopped'));
        }
        return { kind: 'stopped' };
      }
      const passed = result.exitCode === 0;
      const why = passed ? 'passed' : result.timedOut ? `timed out after ${check.timeoutSec}s` : `failed (exit code ${result.exitCode})`;
      this.message(run.id, step.stepId, attempt, { kind: 'output', text: `$ ${check.command}  — ${why}\n${result.tail}` });
      lines.push(`- ${check.name}: ${why}${check.required ? '' : ' (optional)'}`);
      if (!passed && check.required) failures.push(`${check.name} (\`${check.command}\`) ${why}:\n${result.tail.slice(-3_000)}`);
    }
    const report = lines.join('\n') || '- (no checks configured)';
    const done = completed(run.id, step.stepId, attempt, failures.length ? 'failed' : 'succeeded', zeroUsage, Date.now() - started, null, report, failures.length ? `${failures.length} required ${failures.length === 1 ? 'check' : 'checks'} failed` : null);
    if (!failures.length) {
      this.append(run.id, runEvents.stepCompleted, done);
      return { kind: 'passed' };
    }
    return {
      kind: 'rejected',
      feedback: `The project's checks failed:\n\n${failures.join('\n\n')}`,
      events: [{ type: runEvents.stepCompleted, stream: runStream(run.id), data: done, actor: SYSTEM }],
    };
  }

  private async agentStep(
    run: Run,
    step: Extract<PlannedStep, { kind: 'agent' }>,
    attempt: number,
    position: RunPosition,
    active: Active,
    task: Task,
    project: Project,
    resumeSessionId: string | null,
  ): Promise<StepOutcome> {
    const agent = this.deps.library.agent(step.agentId);
    if (!resumeSessionId) this.stepStarted(run.id, step.stepId, attempt, position.index, 'agent', step.name, agent.id, agent.version);
    const { prompt, session } = resumeSessionId
      ? { prompt: resumePrompt, session: resumeSessionId }
      : await this.agentPrompt(run, step, agent, position, task, project);

    for await (const event of this.deps.runtime.run({
      agent,
      cwd: run.worktreePath,
      prompt,
      env: this.deps.env,
      signal: active.controller.signal,
      ...(session ? { resumeSessionId: session } : {}),
    })) {
      if (active.stop === 'shutdown') return { kind: 'stopped' };
      if (event.type === 'session') this.append(run.id, runEvents.stepSession, { runId: run.id, stepId: step.stepId, attempt, sessionId: event.sessionId });
      if (event.type === 'message') this.message(run.id, step.stepId, attempt, event.message);
      if (event.type !== 'result') continue;

      const fail = (status: 'failed' | 'cancelled', error: string): StepOutcome => {
        this.append(run.id, runEvents.stepCompleted, completed(run.id, step.stepId, attempt, status, event.usage, event.durationMs, event.numTurns, event.result, error));
        return status === 'cancelled' ? { kind: 'stopped' } : { kind: 'error', error: `${step.name}: ${error}` };
      };
      if (!event.ok) return active.stop ? fail('cancelled', 'Stopped') : fail('failed', event.error ?? 'failed');

      let output: unknown;
      if (agent.output) {
        const parsed = outputContracts[agent.output].safeParse(event.output);
        if (!parsed.success) return fail('failed', `answered without a valid ${agent.output} (${parsed.error.issues[0]?.message ?? 'invalid'})`);
        output = parsed.data;
      }
      const done: NewEvent = {
        type: runEvents.stepCompleted,
        stream: runStream(run.id),
        data: { ...completed(run.id, step.stepId, attempt, 'succeeded', event.usage, event.durationMs, event.numTurns, event.result, null), ...(output !== undefined ? { output } : {}) },
        actor: SYSTEM,
      };
      if (agent.output !== 'review') {
        this.deps.store.append([done]);
        return { kind: 'passed' };
      }
      return this.judge(run, task, step, agent, output as ReviewOutput, done);
    }
    return { kind: 'error', error: `${step.name}: the agent ended without a result` };
  }

  /** The reviewer's verdict, and the step's gate on it, as decisions. */
  private judge(run: Run, task: Task, step: Extract<PlannedStep, { kind: 'agent' }>, agent: Agent, review: ReviewOutput, done: NewEvent): StepOutcome {
    const verdict = this.deps.decisions.event({
      taskId: task.id,
      runId: run.id,
      stepId: step.stepId,
      kind: 'review.verdict',
      outcome: review.verdict,
      rationale: review.summary,
      alternatives: ['approve', 'request_changes'],
      inputs: { score: review.score, findings: review.findings },
      actor: { kind: 'agent', agentId: agent.id, version: agent.version },
    });
    if (!step.gate) {
      this.deps.store.append([done, verdict]);
      return { kind: 'passed' };
    }
    const passes = review.verdict === 'approve' && review.score >= step.gate.minScore;
    const gate = this.deps.decisions.event({
      taskId: task.id,
      runId: run.id,
      stepId: step.stepId,
      kind: 'gate',
      outcome: passes ? 'pass' : 'fail',
      rationale: passes
        ? `${agent.name} approved with ${review.score}/10 (at least ${step.gate.minScore} needed).`
        : review.verdict === 'approve'
          ? `${agent.name} approved, but ${review.score}/10 is below ${step.gate.minScore}.`
          : `${agent.name} asked for changes (${review.score}/10).`,
      alternatives: ['pass', 'fail'],
      inputs: { score: review.score, minScore: step.gate.minScore, verdict: review.verdict },
      actor: { kind: 'policy', policy: `pipeline:${run.pipelineId}` },
    });
    if (passes) {
      this.deps.store.append([done, verdict, gate]);
      return { kind: 'passed' };
    }
    return { kind: 'rejected', feedback: reviewFeedback(review), events: [done, verdict, gate] };
  }

  private async agentPrompt(
    run: Run,
    step: Extract<PlannedStep, { kind: 'agent' }>,
    agent: Agent,
    position: RunPosition,
    task: Task,
    project: Project,
  ): Promise<{ prompt: string; session: string | null }> {
    const base = taskPrompt(task, project, run.branch);
    const plan = [...position.outputs.values()].find((o): o is PlanOutput => outputContracts.plan.safeParse(o).success) ?? null;
    if (agent.output === 'plan') return { prompt: planningPrompt(base), session: null };
    if (agent.output === 'review') {
      const checks = [...position.reports.values()].at(-1) ?? null;
      return { prompt: reviewPrompt(base, plan, await branchDiff(run.worktreePath, run.baseSha), checks), session: null };
    }
    // a retry continues the agent's previous session with the reason, when there is one
    const previous = position.sessions.get(step.stepId) ?? null;
    if (position.feedback && previous) return { prompt: fixPrompt(position.feedback), session: previous };
    const prompt = implementationPrompt(base, plan);
    return { prompt: position.feedback ? `${prompt}\n\n${fixPrompt(position.feedback)}` : prompt, session: null };
  }

  private command(run: Run, stepId: string, command: string, timeoutMs: number, active: Active) {
    return runCommand(command, {
      cwd: run.worktreePath,
      env: this.deps.env,
      timeoutMs,
      logPath: join(this.deps.dataDir, 'logs', run.id, `${stepId}.log`),
      signal: active.controller.signal,
    });
  }

  /** Records the outcome and moves the task on, if it is still the run's to move. */
  private finish(run: Run, ending: Ending): void {
    this.append(run.id, runEvents.completed, {
      runId: run.id,
      status: ending.status,
      commitSha: 'commitSha' in ending ? (ending.commitSha ?? null) : null,
      error: ending.status === 'succeeded' ? null : ending.error,
    });
    const task = this.task(run.taskId);
    if (task.status !== 'running') return; // e.g. the task was cancelled
    if (ending.status === 'succeeded') this.deps.work.transition(task.id, 'needs_you', ending.reason, SYSTEM);
    else if (ending.status === 'failed') this.deps.work.transition(task.id, ending.taskTo, ending.error, SYSTEM);
    else this.deps.work.transition(task.id, 'failed', ending.error, SYSTEM);
  }

  private stepStarted(runId: string, stepId: string, attempt: number, index: number, kind: 'command' | 'agent' | 'check', name: string, agentId: string | null, agentVersion: string | null) {
    this.append(runId, runEvents.stepStarted, { runId, stepId, attempt, index, kind, name, agentId, agentVersion });
  }

  private message(runId: string, stepId: string, attempt: number, message: RunMessage) {
    this.append(runId, runEvents.stepMessage, { runId, stepId, attempt, message });
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

function completed(
  runId: string,
  stepId: string,
  attempt: number,
  status: 'succeeded' | 'failed' | 'cancelled',
  usage: Usage,
  durationMs: number,
  numTurns: number | null,
  result: string | null,
  error: string | null,
) {
  return { runId, stepId, attempt, status, usage, durationMs: Math.round(durationMs), numTurns, result, error };
}

const stopped = (active: Active): Ending => ({
  status: 'cancelled',
  error: active.stop === 'operator' ? 'Stopped by you' : 'Task cancelled',
});

function commitMessage(task: Task, step: Extract<PlannedStep, { kind: 'agent' }>, attempt: number, summary: string): string {
  const subject = attempt === 1 ? `#${task.number} ${task.title}` : `#${task.number} ${step.name}: fixes (attempt ${attempt})`;
  const body = summary.trim().slice(0, 4_000);
  return `${subject}${body ? `\n\n${body}` : ''}`;
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
