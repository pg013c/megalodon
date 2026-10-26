import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runEvents, type PlanOutput, type ReviewOutput } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import type { AgentRunInput } from '../runtime/types';
import { initRepo, sh } from '../test/repo';
import { ScriptedRuntime, type Script } from '../test/scriptedRuntime';
import { createTestServer } from '../test/server';
import { useTempDir } from '../test/tempDir';
import { agentEnv } from './service';

const tempDir = useTempDir();

const plan: PlanOutput = { summary: 'Add hello.txt', steps: ['Write hello.txt'], touches: ['hello.txt'], risks: [] };
const approve: ReviewOutput = { verdict: 'approve', score: 8, summary: 'Looks right.', findings: [] };
const changes: ReviewOutput = {
  verdict: 'request_changes',
  score: 4,
  summary: 'Missing newline.',
  findings: [{ severity: 'major', file: 'hello.txt', message: 'End the file with a newline' }],
};

type ScriptFn = (input: AgentRunInput, call: number) => Script;

/** Per agent: the planner plans, the implementer writes hello.txt, the reviewer approves. */
const team =
  (overrides: { implementer?: ScriptFn; reviewer?: ScriptFn; planner?: ScriptFn } = {}): ScriptFn =>
  (input, call) => {
    const own = overrides[input.agent.id as keyof typeof overrides];
    if (own) return own(input, call);
    if (input.agent.id === 'planner') return { output: plan };
    if (input.agent.id === 'reviewer') return { output: approve };
    return { files: { 'hello.txt': 'hi\n' } };
  };

async function setup(script: ScriptFn = team(), dir = tempDir()) {
  const runtime = new ScriptedRuntime(script);
  const server = createTestServer(dir, runtime);
  const root = initRepo(join(tempDir(), 'shop'));
  const project = await server.projects.connect(root);
  const task = server.work.createTask(project.id, { kind: 'task', storyId: null, title: 'Say hello', description: 'Add hello.txt' });
  return { ...server, runtime, root, project, task, dir };
}

/** The project checks: hello.txt must exist. */
async function withChecks(server: Awaited<ReturnType<typeof setup>>, maxFixPasses = 2) {
  await server.projects.updateSettings(server.project.id, {
    ...server.project.settings,
    checks: [{ name: 'hello', command: 'test -f hello.txt', required: true, timeoutSec: 30 }],
    maxFixPasses,
  });
}

const agents = (runtime: ScriptedRuntime) => runtime.calls.map((c) => c.agent.id);

describe('RunService: one agent', () => {
  it('runs an agent in its own worktree, commits the result and hands the task to the operator', async () => {
    const { runs, work, runtime, root, task } = await setup();

    const run = await runs.start(task.id, { agentId: 'implementer' });
    expect(work.details(task.id).task.status).toBe('running');
    await runs.idle();

    const finished = runs.details(run.id);
    expect(finished.run).toMatchObject({ status: 'succeeded', pipelineId: 'agent:implementer', branch: 'megalodon/1-say-hello', error: null });
    expect(finished.run.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(finished.run.usage).toMatchObject({ costUsd: 0.01, inputTokens: 100, outputTokens: 50 });
    expect(finished.steps).toMatchObject([{ stepId: 'agent', attempt: 1, status: 'succeeded', agentId: 'implementer', sessionId: 'session-1', numTurns: 2 }]);
    expect(finished.steps[0]?.agentVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(finished.timeline.map((e) => (e.item.type === 'message' ? e.item.message.kind : e.item.type))).toEqual(['text', 'tool_use', 'tool_result', 'decision']);

    // the agent worked in the worktree, never in the operator's checkout
    expect(runtime.calls[0]?.cwd).toBe(finished.run.worktreePath);
    expect(runtime.calls[0]?.prompt).toContain('Task #1 in shop: Say hello');
    expect(existsSync(join(root, 'hello.txt'))).toBe(false);
    expect(sh(root, 'status', '--porcelain')).toBe('');
    expect(sh(root, 'show', 'megalodon/1-say-hello:hello.txt')).toBe('hi\n');
    expect(sh(root, 'log', '-1', '--format=%s', 'megalodon/1-say-hello').trim()).toBe('#1 Say hello');

    expect(work.details(task.id).task).toMatchObject({
      status: 'needs_you',
      statusReason: 'The pipeline has no gate; review megalodon/1-say-hello and merge it.',
    });
  });

  it('runs the project setup commands first, in the worktree', async () => {
    const { runs, projects, project, task } = await setup();
    await projects.updateSettings(project.id, { ...project.settings, setup: ['echo ready > setup.txt'] });

    const run = await runs.start(task.id, { agentId: 'implementer' });
    await runs.idle();

    const details = runs.details(run.id);
    expect(details.steps.map((s) => [s.stepId, s.status])).toEqual([
      ['setup', 'succeeded'],
      ['agent', 'succeeded'],
    ]);
    expect(readFileSync(join(details.run.worktreePath, 'setup.txt'), 'utf8')).toBe('ready\n');
  });

  it('fails the run and the task when setup fails, without starting the agent', async () => {
    const { runs, projects, project, task, runtime, work } = await setup();
    await projects.updateSettings(project.id, { ...project.settings, setup: ['exit 3'] });

    const run = await runs.start(task.id, { agentId: 'implementer' });
    await runs.idle();

    expect(runs.details(run.id).run).toMatchObject({ status: 'failed', error: 'Setup failed' });
    expect(runs.details(run.id).steps[0]).toMatchObject({ status: 'failed', error: '`exit 3` exit code 3' });
    expect(runtime.calls).toHaveLength(0);
    expect(work.details(task.id).task).toMatchObject({ status: 'failed', statusReason: 'Setup failed' });
  });

  it('fails when the agent fails, and retries on a fresh branch', async () => {
    const { runs, task, work } = await setup((_, call) => (call === 1 ? { ok: false, error: 'error_max_turns' } : { files: { 'a.txt': 'a' } }));

    const first = await runs.start(task.id, { agentId: 'implementer' });
    await runs.idle();
    expect(runs.details(first.id).run).toMatchObject({ status: 'failed', error: 'Implementer: error_max_turns' });
    expect(work.details(task.id).task.status).toBe('failed');

    const second = await runs.start(task.id, { agentId: 'implementer' });
    await runs.idle();
    expect(runs.details(second.id).run).toMatchObject({ status: 'succeeded', branch: 'megalodon/1-say-hello-2' });
    expect(runs.forTask(task.id).map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it('records a run without changes and says so', async () => {
    const { runs, task, work } = await setup(() => ({}));
    const run = await runs.start(task.id, { agentId: 'implementer' });
    await runs.idle();
    expect(runs.details(run.id).run).toMatchObject({ status: 'succeeded', commitSha: null });
    expect(work.details(task.id).task.statusReason).toBe('The run finished without changing any files');
  });

  it('stops a run on request; the task fails and can be retried', async () => {
    const { runs, task, work } = await setup(() => ({ hang: true }));
    const run = await runs.start(task.id, { agentId: 'implementer' });

    runs.stop(run.id);
    await runs.idle();

    expect(runs.details(run.id).run).toMatchObject({ status: 'cancelled', error: 'Stopped by you' });
    expect(work.details(task.id).task).toMatchObject({ status: 'failed', statusReason: 'Stopped by you' });
  });

  it('stops the run when its task is cancelled', async () => {
    const { runs, task, work } = await setup(() => ({ hang: true }));
    const run = await runs.start(task.id, { agentId: 'implementer' });

    work.cancel(task.id);
    await runs.idle();

    expect(runs.details(run.id).run).toMatchObject({ status: 'cancelled', error: 'Task cancelled' });
    expect(work.details(task.id).task.status).toBe('cancelled');
  });

  it('refuses a second run, manual tasks, unknown agents and unknown pipelines', async () => {
    const { runs, work, project, task } = await setup(() => ({ hang: true }));
    await runs.start(task.id, { agentId: 'implementer' });
    await expect(runs.start(task.id, { agentId: 'implementer' })).rejects.toMatchObject({ code: 'RUN_IN_PROGRESS' });

    const manual = work.createTask(project.id, { kind: 'manual', storyId: null, title: 'Key', description: '' });
    await expect(runs.start(manual.id, { agentId: 'implementer' })).rejects.toMatchObject({ code: 'NOT_AN_AGENT_TASK' });

    const other = work.createTask(project.id, { kind: 'task', storyId: null, title: 'Other', description: '' });
    await expect(runs.start(other.id, { agentId: 'nobody' })).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
    await expect(runs.start(other.id, { pipelineId: 'nothing' })).rejects.toMatchObject({ code: 'PIPELINE_NOT_FOUND' });
    await runs.shutdown();
  });
});

describe('RunService: the feature pipeline', () => {
  it('plans, implements, checks and reviews, and records the verdict and the gate', async () => {
    const server = await setup();
    await withChecks(server);
    const { runs, runtime, task, work, decisions } = server;

    const run = await runs.start(task.id, { pipelineId: 'feature' });
    await runs.idle();

    const details = runs.details(run.id);
    expect(details.run).toMatchObject({ status: 'succeeded', pipelineId: 'feature' });
    expect(details.run.pipelineVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(details.plan.map((s) => s.stepId)).toEqual(['plan', 'implement', 'checks', 'review']);
    expect(details.steps.map((s) => [s.stepId, s.attempt, s.status])).toEqual([
      ['plan', 1, 'succeeded'],
      ['implement', 1, 'succeeded'],
      ['checks', 1, 'succeeded'],
      ['review', 1, 'succeeded'],
    ]);
    expect(agents(runtime)).toEqual(['planner', 'implementer', 'reviewer']);

    // each agent got what the previous steps produced
    expect(runtime.calls[1]?.prompt).toContain('1. Write hello.txt');
    expect(runtime.calls[2]?.prompt).toContain('hello.txt');
    expect(runtime.calls[2]?.prompt).toContain('- hello: passed');

    const made = decisions.queries.forRun(run.id);
    expect(made.map((d) => [d.kind, d.outcome, d.actor.kind])).toEqual([
      ['review.verdict', 'approve', 'agent'],
      ['gate', 'pass', 'policy'],
      ['merge', 'merge', 'policy'],
    ]);
    expect(made[1]?.rationale).toBe('Reviewer approved with 8/10 (at least 7 needed).');
    expect(details.timeline.filter((e) => e.item.type === 'decision')).toHaveLength(3);
    expect(work.details(task.id).task).toMatchObject({
      status: 'merging',
      statusReason: 'Reviewer approved with 8/10 (at least 7 needed). Queued to merge.',
    });
  });

  it('sends failing checks back to the implementer, who continues its session', async () => {
    const server = await setup(team({ implementer: (_, call) => (call === 2 ? {} : { files: { 'hello.txt': 'hi\n' } }) }));
    await withChecks(server);
    const { runs, runtime, task, decisions } = server;

    const run = await runs.start(task.id, { pipelineId: 'feature' });
    await runs.idle();

    const details = runs.details(run.id);
    expect(details.run.status).toBe('succeeded');
    expect(details.steps.map((s) => [s.stepId, s.attempt, s.status])).toEqual([
      ['plan', 1, 'succeeded'],
      ['implement', 1, 'succeeded'],
      ['checks', 1, 'failed'],
      ['implement', 2, 'succeeded'],
      ['checks', 2, 'succeeded'],
      ['review', 1, 'succeeded'],
    ]);
    const retry = runtime.calls[2]!;
    expect(retry.agent.id).toBe('implementer');
    expect(retry.resumeSessionId).toBe('session-2');
    expect(retry.prompt).toContain("The project's checks failed");
    expect(retry.prompt).toContain('test -f hello.txt');
    expect(decisions.queries.forRun(run.id)[0]).toMatchObject({ kind: 'retry', outcome: 'retry implement', stepId: 'checks' });
  });

  it('stops after the fix passes and hands the task to the operator', async () => {
    const server = await setup(team({ implementer: () => ({}) }));
    await withChecks(server, 1);
    const { runs, task, work, decisions } = server;

    const run = await runs.start(task.id, { pipelineId: 'feature' });
    await runs.idle();

    expect(runs.details(run.id).run).toMatchObject({ status: 'failed', error: 'Checks did not pass' });
    expect(decisions.queries.forRun(run.id).map((d) => d.outcome)).toEqual(['retry implement', 'stop']);
    expect(work.details(task.id).task).toMatchObject({ status: 'needs_you', statusReason: 'Checks did not pass' });
  });

  it('sends a review that asks for changes back to the implementer once', async () => {
    const server = await setup(team({ reviewer: (_, call) => ({ output: call === 3 ? changes : approve }) }));
    const { runs, runtime, task, decisions } = server;

    const run = await runs.start(task.id, { pipelineId: 'feature' });
    await runs.idle();

    expect(runs.details(run.id).run.status).toBe('succeeded');
    expect(agents(runtime)).toEqual(['planner', 'implementer', 'reviewer', 'implementer', 'reviewer']);
    expect(runtime.calls[3]?.prompt).toContain('End the file with a newline');
    expect(decisions.queries.forRun(run.id).map((d) => `${d.kind}:${d.outcome}`)).toEqual([
      'review.verdict:request_changes',
      'gate:fail',
      'retry:retry implement',
      'review.verdict:approve',
      'gate:pass',
      'merge:merge',
    ]);
  });

  it('fails the run when an agent answers outside its contract', async () => {
    const { runs, task, work } = await setup(team({ planner: () => ({ output: { nope: true } }) }));
    const run = await runs.start(task.id, { pipelineId: 'feature' });
    await runs.idle();
    expect(runs.details(run.id).run.error).toContain('Planner: answered without a valid plan');
    expect(work.details(task.id).task.status).toBe('failed');
  });

  it('continues a pipeline interrupted by a restart without redoing finished steps', async () => {
    const dir = tempDir();
    const first = await setup(team({ implementer: () => ({ hang: true }) }), dir);
    const run = await first.runs.start(first.task.id, { pipelineId: 'feature' });
    while (!first.runs.details(run.id).steps.find((s) => s.stepId === 'implement')?.sessionId) await new Promise((r) => setTimeout(r, 5));
    await first.runs.shutdown();

    const runtime = new ScriptedRuntime(team());
    const second = createTestServer(dir, runtime);
    second.runs.recover();
    await second.runs.idle();

    expect(agents(runtime)).toEqual(['implementer', 'reviewer']);
    expect(runtime.calls[0]?.resumeSessionId).toBe('session-2');
    expect(runtime.calls[0]?.prompt).toContain('Megalodon was restarted');
    expect(second.runs.details(run.id).run.status).toBe('succeeded');
    expect(second.store.readStream(`run:${run.id}`).map((e) => e.type)).toContain(runEvents.resumed);
  });
});

describe('RunService: recovery and rebuild', () => {
  it('fails a run whose worktree disappeared while the server was down', async () => {
    const dir = tempDir();
    const first = await setup(() => ({ hang: true }), dir);
    const run = await first.runs.start(first.task.id, { agentId: 'implementer' });
    await first.runs.shutdown();
    rmSync(first.runs.details(run.id).run.worktreePath, { recursive: true, force: true });

    const second = createTestServer(dir);
    second.runs.recover();

    expect(second.runs.details(run.id).run).toMatchObject({ status: 'failed', error: 'The worktree disappeared while Megalodon was stopped' });
    expect(second.work.details(first.task.id).task.status).toBe('failed');
  });

  it('rebuilds runs, steps and decisions from the log', async () => {
    const { runs, store, task } = await setup();
    const run = await runs.start(task.id, { pipelineId: 'feature' });
    await runs.idle();
    const before = runs.details(run.id);
    store.rebuild();
    expect(runs.details(run.id)).toEqual(before);
  });

  it('reads runs recorded before pipelines existed', async () => {
    const { store, runs, task, project } = await setup();
    store.append([
      {
        type: runEvents.started,
        stream: 'run:old',
        data: {
          runId: 'old',
          taskId: task.id,
          projectId: project.id,
          agentId: 'implementer',
          branch: 'b',
          worktreePath: '/nowhere',
          baseRef: 'main',
          baseSha: 'x',
          plan: [{ kind: 'agent', stepId: 'agent', name: 'Implementer', agentId: 'implementer' }],
        },
        actor: { kind: 'operator' },
      },
      {
        type: runEvents.stepStarted,
        stream: 'run:old',
        data: { runId: 'old', stepId: 'agent', index: 0, kind: 'agent', name: 'Implementer', agentId: 'implementer', agentVersion: 'v' },
        actor: { kind: 'system' },
      },
    ]);
    store.rebuild();
    const old = runs.details('old');
    expect(old.run).toMatchObject({ pipelineId: 'agent:implementer', pipelineVersion: 'unknown' });
    expect(old.plan[0]).toMatchObject({ gate: null, onFail: null });
    expect(old.steps[0]?.attempt).toBe(1);
  });
});

describe('agentEnv', () => {
  it('hides integration credentials and Megalodon settings from agents', () => {
    const env = agentEnv({ PATH: '/bin', AWS_PROFILE: 'prod', GH_TOKEN: 't', MEGALODON_PORT: '1', HOME: '/h', NOPE: undefined });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h' });
  });
});
