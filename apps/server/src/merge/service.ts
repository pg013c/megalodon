import { join } from 'node:path';
import {
  decisionEvents,
  mergeEvents,
  mergeStream,
  taskStream,
  zeroUsage,
  type Actor,
  type Decision,
  type MergeBlock,
  type NewEvent,
  type Project,
  type Run,
  type Task,
} from '@megalodon/contracts';
import type { DecisionService } from '../decisions/service';
import { AppError } from '../errors';
import { git, GitError } from '../git/git';
import type { EventStore } from '../events/store';
import type { Library } from '../library/library';
import type { ProjectsQueries } from '../projects/projection';
import { runCommand } from '../runs/command';
import { removeWorktree, worktreeExists } from '../runs/git';
import type { RunsQueries } from '../runs/projection';
import type { AgentRuntime } from '../runtime/types';
import type { WorkService } from '../work/service';
import {
  abortMerge,
  branchTip,
  concludeMerge,
  currentBranch,
  deleteBranch,
  dirtyFiles,
  hasConflictMarkers,
  isAncestor,
  merge,
  mergeHead,
  predictConflicts,
  unmergedFiles,
} from './git';
import type { MergeQueries } from './projection';

const MERGE_QUEUE: Actor = { kind: 'policy', policy: 'merge-queue' };
const OPERATOR: Actor = { kind: 'operator' };
const TICK_EVERY_MS = 15_000;

export interface MergeDeps {
  store: EventStore;
  queries: MergeQueries;
  work: WorkService;
  runs: RunsQueries;
  decisions: DecisionService;
  projects: ProjectsQueries;
  library: Library;
  runtime: AgentRuntime;
  dataDir: string;
  env: Record<string, string>;
}

type Outcome = { ok: true; sha: string; pushed?: string | null } | { ok: false; reason: string };

/**
 * The merge queue, serial per project (ADR-0008, ADR-0014): bring the task's branch up to date
 * with the base in its worktree (resolving conflicts with an agent), re-run the checks, merge in
 * the operator's checkout when it is clean and on the base, clean up, mark the task done.
 */
export class MergeService {
  private readonly busy = new Map<string, Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly deps: MergeDeps) {
    // an operator overriding a failed gate, or a held merge, sends the task to the queue
    deps.store.subscribe((event) => {
      if (event.type !== decisionEvents.made || event.actor.kind !== 'operator') return;
      const d = event.data as Pick<Decision, 'taskId' | 'kind' | 'outcome' | 'overrides'>;
      if (!d.overrides) return;
      if ((d.kind === 'gate' && d.outcome === 'pass') || (d.kind === 'merge' && d.outcome === 'merge')) {
        const task = deps.work.queries.task(d.taskId);
        if (task?.status === 'needs_you' && this.mergeableRun(task)) deps.work.transition(task.id, 'merging', 'You approved the merge', OPERATOR);
      }
    });
  }

  start(): void {
    this.unsubscribe = this.deps.store.subscribe((event) => {
      if (event.type === 'task.status_changed' && (event.data as { to: string }).to === 'merging') queueMicrotask(() => void this.tick());
    });
    this.timer = setInterval(() => void this.tick(), TICK_EVERY_MS);
    void this.tick();
  }

  stop(): void {
    this.unsubscribe?.();
    if (this.timer) clearInterval(this.timer);
  }

  blocks(): MergeBlock[] {
    return this.deps.queries.blocks().map((b) => ({ ...b, projectName: this.deps.projects.get(b.projectId)?.name ?? '' }));
  }

  /** The operator merges a task waiting for review. */
  enqueue(taskId: string): Task {
    const task = this.deps.work.queries.task(taskId);
    if (!task) throw new AppError(404, 'TASK_NOT_FOUND', `No task ${taskId}`);
    if (!this.mergeableRun(task)) throw new AppError(409, 'NOTHING_TO_MERGE', `#${task.number} has no finished run with changes`);
    this.deps.store.append([
      this.deps.decisions.event({
        taskId,
        runId: this.mergeableRun(task)!.id,
        stepId: null,
        kind: 'merge',
        outcome: 'merge',
        rationale: 'Merged on your request.',
        alternatives: ['merge', 'hold'],
        actor: OPERATOR,
      }),
    ]);
    return this.deps.work.transition(taskId, 'merging', 'Queued to merge by you', OPERATOR);
  }

  /** Every project with tasks to merge gets its own serial worker. */
  async tick(): Promise<void> {
    const projects = new Set(this.deps.work.queries.inStatus(['merging']).map((t) => t.projectId));
    for (const projectId of this.deps.queries.blocks().map((b) => b.projectId)) projects.add(projectId);
    await Promise.all([...projects].map((id) => this.project(id)));
  }

  /** On startup: undo merges a stopped server left half done, then continue the queue. */
  async recover(): Promise<void> {
    for (const task of this.deps.work.queries.inStatus(['merging'])) {
      const project = this.deps.projects.get(task.projectId);
      const run = this.mergeableRun(task);
      if (!project || !run) continue;
      if (worktreeExists(run.worktreePath) && (await mergeHead(run.worktreePath))) {
        await abortMerge(run.worktreePath);
        this.event(task, mergeEvents.recovered, { runId: run.id, detail: "Aborted the update from the base in the task's worktree" });
      }
      const tip = await branchTip(project.path, run.branch);
      const head = await mergeHead(project.path);
      // only a merge of exactly this branch, left in the checkout by Megalodon, is undone
      if (tip && head === tip) {
        await abortMerge(project.path);
        this.event(task, mergeEvents.recovered, { runId: run.id, detail: 'Aborted a half-finished merge in your checkout' });
      }
    }
    await this.tick();
  }

  private project(projectId: string): Promise<void> {
    const running = this.busy.get(projectId);
    if (running) return running;
    const work = this.drain(projectId).finally(() => this.busy.delete(projectId));
    this.busy.set(projectId, work);
    return work;
  }

  private async drain(projectId: string): Promise<void> {
    for (;;) {
      const project = this.deps.projects.get(projectId);
      if (!project) return;
      const blocked = await this.checkoutProblem(project);
      this.setBlock(project, blocked);
      if (blocked) return;
      const task = this.deps.work.queries.inStatus(['merging']).find((t) => t.projectId === projectId);
      if (!task) return;
      await this.mergeTask(task, project);
    }
  }

  /** Why the operator's checkout cannot take a merge now, or null (ADR-0014). */
  private async checkoutProblem(project: Project): Promise<string | null> {
    const base = project.settings.baseBranch;
    const branch = await currentBranch(project.path);
    if (branch !== base) return `Your checkout is on ${branch ?? 'a detached HEAD'}; switch back to ${base} to let merges continue.`;
    if (await mergeHead(project.path)) return 'A merge is in progress in your checkout; finish or abort it.';
    const dirty = await dirtyFiles(project.path);
    if (dirty.length) return `Your checkout has uncommitted changes (${dirty.slice(0, 3).join(', ')}${dirty.length > 3 ? ', …' : ''}); commit or stash them.`;
    return null;
  }

  private setBlock(project: Project, reason: string | null): void {
    const current = this.deps.queries.block(project.id);
    if (reason && reason !== current) {
      this.deps.store.append([{ type: mergeEvents.blocked, stream: mergeStream(project.id), data: { projectId: project.id, reason }, actor: MERGE_QUEUE }]);
    }
    if (!reason && current) {
      this.deps.store.append([{ type: mergeEvents.unblocked, stream: mergeStream(project.id), data: { projectId: project.id }, actor: MERGE_QUEUE }]);
    }
  }

  private async mergeTask(task: Task, project: Project): Promise<void> {
    const run = this.mergeableRun(task);
    if (!run) return this.finish(task, null, { ok: false, reason: 'There is no finished run with changes to merge' });
    this.event(task, mergeEvents.started, { runId: run.id, branch: run.branch });
    let outcome: Outcome;
    try {
      outcome = await this.process(task, project, run);
    } catch (error) {
      outcome = { ok: false, reason: `Merge error: ${(error as Error).message}` };
    }
    this.finish(task, run, outcome);
  }

  private async process(task: Task, project: Project, run: Run): Promise<Outcome> {
    const base = `refs/heads/${project.settings.baseBranch}`;
    const tip = await branchTip(project.path, run.branch);
    if (!tip) return { ok: false, reason: `The branch ${run.branch} is gone` };
    // a merge a restart interrupted after it landed
    if (await isAncestor(project.path, tip, base)) {
      await this.cleanUp(project, run);
      return { ok: true, sha: (await branchTip(project.path, project.settings.baseBranch)) ?? tip };
    }
    if (!worktreeExists(run.worktreePath)) return { ok: false, reason: `The worktree of ${run.branch} is gone` };

    if (!(await isAncestor(project.path, base, tip))) {
      const predicted = await predictConflicts(project.path, base, tip);
      this.event(task, mergeEvents.updated, { runId: run.id, conflicts: predicted });
      const conflicts = await merge(run.worktreePath, base, `Merge ${project.settings.baseBranch} into ${run.branch}`);
      if (conflicts.length) {
        const resolved = await this.resolve(task, project, run, conflicts);
        if (!resolved.ok) {
          await abortMerge(run.worktreePath);
          return resolved;
        }
      }
      // the base moved: what was checked before is not what will be merged now
      const checked = await this.recheck(project, run);
      if (!checked.ok) return checked;
    }

    const problem = await this.checkoutProblem(project);
    if (problem) {
      this.setBlock(project, problem);
      return { ok: false, reason: 'blocked' };
    }
    const conflicts = await merge(project.path, `refs/heads/${run.branch}`, `Merge #${task.number} ${task.title}`);
    if (conflicts.length) {
      await abortMerge(project.path);
      return { ok: false, reason: `Unexpected conflicts in your checkout: ${conflicts.join(', ')}` };
    }
    const sha = (await branchTip(project.path, project.settings.baseBranch))!;
    await this.cleanUp(project, run);
    return { ok: true, sha, pushed: await this.push(task, project) };
  }

  /** The push gate (ADR-0028): push the base branch after a merge, or leave it to the operator. */
  private async push(task: Task, project: Project): Promise<string | null> {
    const policy = project.settings.policies.push;
    if (policy.mode !== 'auto') return null;
    try {
      await git(project.path, ['push', policy.remote, project.settings.baseBranch], { timeoutMs: 120_000 });
      this.event(task, mergeEvents.pushed, { remote: policy.remote });
      return `pushed to ${policy.remote}`;
    } catch (error) {
      const reason = error instanceof GitError ? error.stderr.trim() || error.message : (error as Error).message;
      this.event(task, mergeEvents.pushFailed, { remote: policy.remote, reason });
      return `push to ${policy.remote} failed: ${reason.split('\n')[0]}`;
    }
  }

  /** The resolver agent gets two attempts; whatever still conflicts goes to the operator. */
  private async resolve(task: Task, project: Project, run: Run, conflicts: string[]): Promise<Outcome> {
    const policy = project.settings.policies.conflicts;
    if (policy.mode === 'operator') {
      this.event(task, mergeEvents.conflict, { runId: run.id, files: conflicts, attempt: 0 });
      return { ok: false, reason: `Conflicts with ${project.settings.baseBranch} in ${conflicts.join(', ')}; the project asks you to resolve conflicts.` };
    }
    const agent = this.deps.library.agent('resolver');
    let remaining = conflicts;
    for (let attempt = 1; attempt <= policy.attempts; attempt++) {
      this.event(task, mergeEvents.conflict, { runId: run.id, files: remaining, attempt });
      const prompt = [
        `Task #${task.number} in ${project.name}: ${task.title}`,
        '',
        task.description.trim(),
        '',
        `Merging \`${project.settings.baseBranch}\` into \`${run.branch}\` conflicts in:`,
        ...remaining.map((f) => `- ${f}`),
        '',
        'Resolve the conflicts.',
      ].join('\n');
      let summary: string | null = null;
      let usage = zeroUsage;
      for await (const event of this.deps.runtime.run({ agent, cwd: run.worktreePath, prompt, env: this.deps.env, signal: new AbortController().signal })) {
        if (event.type === 'result') {
          summary = event.ok ? event.result : null;
          usage = event.usage;
        }
      }
      remaining = hasConflictMarkers(run.worktreePath, await unmergedFiles(run.worktreePath).then((u) => [...new Set([...u, ...remaining])]));
      this.event(task, mergeEvents.resolved, { runId: run.id, attempt, remaining, summary, usage, agentVersion: agent.version });
      if (!remaining.length) {
        await concludeMerge(run.worktreePath);
        return { ok: true, sha: '' };
      }
    }
    return { ok: false, reason: `Conflicts with ${project.settings.baseBranch} the resolver could not settle: ${remaining.join(', ')}` };
  }

  /** Setup and checks again, after the branch took in the base. */
  private async recheck(project: Project, run: Run): Promise<Outcome> {
    const commands = [
      ...project.settings.setup.map((command) => ({ command, required: true, timeoutSec: 15 * 60, name: 'setup' })),
      ...project.settings.checks,
    ];
    for (const check of commands) {
      const result = await runCommand(check.command, {
        cwd: run.worktreePath,
        env: this.deps.env,
        timeoutMs: check.timeoutSec * 1000,
        logPath: join(this.deps.dataDir, 'logs', run.id, 'merge.log'),
        signal: new AbortController().signal,
      });
      if (result.exitCode !== 0 && check.required) {
        return { ok: false, reason: `${check.name} fails after updating from ${project.settings.baseBranch} (\`${check.command}\`):\n${result.tail.slice(-1500)}` };
      }
    }
    return { ok: true, sha: '' };
  }

  private async cleanUp(project: Project, run: Run): Promise<void> {
    if (worktreeExists(run.worktreePath)) await removeWorktree(project.path, run.worktreePath).catch(() => undefined);
    await deleteBranch(project.path, run.branch).catch(() => undefined);
  }

  private finish(task: Task, run: Run | null, outcome: Outcome): void {
    // a blocked checkout leaves the task in the queue; the project waits
    if (!outcome.ok && outcome.reason === 'blocked') return;
    if (outcome.ok) {
      this.event(task, mergeEvents.completed, { runId: run?.id ?? null, sha: outcome.sha });
      this.deps.work.transition(task.id, 'done', `Merged as ${outcome.sha.slice(0, 8)}${outcome.pushed ? `; ${outcome.pushed}` : ''}`, MERGE_QUEUE);
    } else {
      this.event(task, mergeEvents.failed, { runId: run?.id ?? null, reason: outcome.reason });
      this.deps.work.transition(task.id, 'needs_you', outcome.reason, MERGE_QUEUE);
    }
  }

  /**
   * The task's newest run, when it finished with commits: succeeded, or failed only because checks
   * or the review never passed (the operator may still merge it).
   */
  private mergeableRun(task: Task): Run | null {
    const latest = this.deps.runs.forTask(task.id)[0];
    return latest && latest.commitSha !== null && (latest.status === 'succeeded' || latest.status === 'failed') ? latest : null;
  }

  private event(task: Task, type: string, data: Record<string, unknown>): void {
    const event: NewEvent = { type, stream: taskStream(task.id), data: { taskId: task.id, ...data }, actor: MERGE_QUEUE };
    this.deps.store.append([event]);
  }
}
