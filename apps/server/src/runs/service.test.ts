import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { runEvents } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { initRepo, sh } from '../test/repo';
import { ScriptedRuntime, type Script } from '../test/scriptedRuntime';
import { createTestServer } from '../test/server';
import { useTempDir } from '../test/tempDir';
import { agentEnv } from './service';

const tempDir = useTempDir();

async function setup(script: (n: number) => Script = () => ({ files: { 'hello.txt': 'hi\n' } }), dir = tempDir()) {
  let n = 0;
  const runtime = new ScriptedRuntime(() => script(++n));
  const server = createTestServer(dir, runtime);
  const root = initRepo(join(tempDir(), 'shop'));
  const project = await server.projects.connect(root);
  const task = server.work.createTask(project.id, { kind: 'task', storyId: null, title: 'Say hello', description: 'Add hello.txt' });
  return { ...server, runtime, root, project, task, dir };
}

describe('RunService', () => {
  it('runs an agent in its own worktree, commits the result and hands the task to the operator', async () => {
    const { runs, work, runtime, root, task } = await setup();

    const run = await runs.start(task.id, 'implementer');
    expect(work.details(task.id).task.status).toBe('running');
    await runs.idle();

    const finished = runs.details(run.id);
    expect(finished.run).toMatchObject({ status: 'succeeded', branch: 'megalodon/1-say-hello', error: null });
    expect(finished.run.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(finished.run.usage).toMatchObject({ costUsd: 0.01, inputTokens: 100, outputTokens: 50 });
    expect(finished.steps).toMatchObject([{ stepId: 'agent', status: 'succeeded', agentId: 'implementer', sessionId: 'session-1', numTurns: 2 }]);
    expect(finished.steps[0]?.agentVersion).toMatch(/^[0-9a-f]{12}$/);
    expect(finished.timeline.map((e) => e.message.kind)).toEqual(['text', 'tool_use', 'tool_result']);

    // the agent worked in the worktree, never in the operator's checkout
    expect(runtime.calls[0]?.cwd).toBe(finished.run.worktreePath);
    expect(runtime.calls[0]?.prompt).toContain('Task #1 in shop: Say hello');
    expect(existsSync(join(root, 'hello.txt'))).toBe(false);
    expect(sh(root, 'status', '--porcelain')).toBe('');
    expect(sh(root, 'show', 'megalodon/1-say-hello:hello.txt')).toBe('hi\n');
    expect(sh(root, 'log', '-1', '--format=%s', 'megalodon/1-say-hello').trim()).toBe('#1 Say hello');

    expect(work.details(task.id).task).toMatchObject({ status: 'needs_you', statusReason: 'Review megalodon/1-say-hello' });
  });

  it('runs the project setup commands first, in the worktree', async () => {
    const { runs, projects, project, task } = await setup();
    await projects.updateSettings(project.id, { ...project.settings, setup: ['echo ready > setup.txt'] });

    const run = await runs.start(task.id, 'implementer');
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

    const run = await runs.start(task.id, 'implementer');
    await runs.idle();

    expect(runs.details(run.id).run).toMatchObject({ status: 'failed', error: 'Setup failed' });
    expect(runs.details(run.id).steps[0]).toMatchObject({ status: 'failed', error: '`exit 3` exit code 3' });
    expect(runtime.calls).toHaveLength(0);
    expect(work.details(task.id).task).toMatchObject({ status: 'failed', statusReason: 'Setup failed' });
  });

  it('fails when the agent fails, and retries on a fresh branch', async () => {
    const { runs, task, work } = await setup((n) => (n === 1 ? { ok: false, error: 'error_max_turns' } : { files: { 'a.txt': 'a' } }));

    const first = await runs.start(task.id, 'implementer');
    await runs.idle();
    expect(runs.details(first.id).run.status).toBe('failed');
    expect(work.details(task.id).task.status).toBe('failed');

    const second = await runs.start(task.id, 'implementer');
    await runs.idle();
    expect(runs.details(second.id).run).toMatchObject({ status: 'succeeded', branch: 'megalodon/1-say-hello-2' });
    expect(runs.forTask(task.id).map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it('records a run without changes and says so', async () => {
    const { runs, task, work } = await setup(() => ({}));
    const run = await runs.start(task.id, 'implementer');
    await runs.idle();
    expect(runs.details(run.id).run).toMatchObject({ status: 'succeeded', commitSha: null });
    expect(work.details(task.id).task.statusReason).toBe('The agent finished without changing any files');
  });

  it('stops a run on request; the task fails and can be retried', async () => {
    const { runs, task, work } = await setup(() => ({ hang: true }));
    const run = await runs.start(task.id, 'implementer');

    runs.stop(run.id);
    await runs.idle();

    expect(runs.details(run.id).run).toMatchObject({ status: 'cancelled', error: 'Stopped by you' });
    expect(work.details(task.id).task).toMatchObject({ status: 'failed', statusReason: 'Stopped by you' });
  });

  it('stops the run when its task is cancelled', async () => {
    const { runs, task, work } = await setup(() => ({ hang: true }));
    const run = await runs.start(task.id, 'implementer');

    work.cancel(task.id);
    await runs.idle();

    expect(runs.details(run.id).run).toMatchObject({ status: 'cancelled', error: 'Task cancelled' });
    expect(work.details(task.id).task.status).toBe('cancelled');
  });

  it('refuses a second run, manual tasks and unknown agents', async () => {
    const { runs, work, project, task } = await setup(() => ({ hang: true }));
    await runs.start(task.id, 'implementer');
    await expect(runs.start(task.id, 'implementer')).rejects.toMatchObject({ code: 'RUN_IN_PROGRESS' });

    const manual = work.createTask(project.id, { kind: 'manual', storyId: null, title: 'Key', description: '' });
    await expect(runs.start(manual.id, 'implementer')).rejects.toMatchObject({ code: 'NOT_AN_AGENT_TASK' });

    const other = work.createTask(project.id, { kind: 'task', storyId: null, title: 'Other', description: '' });
    await expect(runs.start(other.id, 'nobody')).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
    await runs.shutdown();
  });

  it('resumes the agent session of a run interrupted by a restart', async () => {
    const dir = tempDir();
    const first = await setup(() => ({ hang: true }), dir);
    const run = await first.runs.start(first.task.id, 'implementer');
    // wait until the session is known, then stop the server without recording an outcome
    while (!first.runs.details(run.id).steps[0]?.sessionId) await new Promise((r) => setTimeout(r, 5));
    await first.runs.shutdown();
    expect(first.runs.details(run.id).run.status).toBe('running');

    const runtime = new ScriptedRuntime(() => ({ files: { 'resumed.txt': 'x' } }));
    const second = createTestServer(dir, runtime);
    second.runs.recover();
    await second.runs.idle();

    expect(runtime.calls[0]?.resumeSessionId).toBe('session-1');
    expect(runtime.calls[0]?.prompt).toContain('Megalodon was restarted');
    expect(second.runs.details(run.id).run.status).toBe('succeeded');
    expect(second.store.readStream(`run:${run.id}`).map((e) => e.type)).toContain(runEvents.resumed);
  });

  it('fails a run whose worktree disappeared while the server was down', async () => {
    const dir = tempDir();
    const first = await setup(() => ({ hang: true }), dir);
    const run = await first.runs.start(first.task.id, 'implementer');
    await first.runs.shutdown();
    rmSync(first.runs.details(run.id).run.worktreePath, { recursive: true, force: true });

    const second = createTestServer(dir);
    second.runs.recover();

    expect(second.runs.details(run.id).run).toMatchObject({ status: 'failed', error: 'The worktree disappeared while Megalodon was stopped' });
    expect(second.work.details(first.task.id).task.status).toBe('failed');
  });

  it('rebuilds runs and steps from the log', async () => {
    const { runs, store, task } = await setup();
    const run = await runs.start(task.id, 'implementer');
    await runs.idle();
    const before = runs.details(run.id);
    store.rebuild();
    expect(runs.details(run.id)).toEqual(before);
  });
});

describe('agentEnv', () => {
  it('hides integration credentials and Megalodon settings from agents', () => {
    const env = agentEnv({ PATH: '/bin', AWS_PROFILE: 'prod', GH_TOKEN: 't', MEGALODON_PORT: '1', HOME: '/h', NOPE: undefined });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h' });
  });
});
