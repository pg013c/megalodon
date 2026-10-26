import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TriageOutput } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { initRepo, sh } from '../test/repo';
import { ScriptedRuntime, type Script } from '../test/scriptedRuntime';
import { createTestServer } from '../test/server';
import { useTempDir } from '../test/tempDir';

const tempDir = useTempDir();

const triage = (output: Partial<TriageOutput> = {}): Script => ({
  output: { summary: 'Adds Stripe checkout.', touches: ['src/payments/**'], pipeline: 'feature', dependsOn: [], manualTasks: [], ...output },
});

async function setup(script: () => Script, autoTriage = false) {
  const runtime = new ScriptedRuntime(() => script());
  const dir = tempDir();
  const server = createTestServer(dir, runtime, { autoTriage });
  const root = initRepo(join(tempDir(), 'shop'));
  const project = await server.projects.connect(root);
  return { ...server, runtime, project, root, dir };
}

describe('TriageService', () => {
  it('turns the triage into a touch-set, pipeline, dependencies and manual tasks, then queues the task', async () => {
    const { work, triage: lane, runtime, project, scheduler, decisions, root, dir } = await setup(() =>
      triage({
        dependsOn: [{ number: 1, reason: 'Needs user accounts' }, { number: 99, reason: 'Made up' }],
        manualTasks: [{ title: 'Create a Stripe API key', description: 'Dashboard → Developers → API keys', reason: 'Checkout calls Stripe' }],
      }),
    );
    const users = work.createTask(project.id, { kind: 'task', storyId: null, title: 'Users', description: '' });
    const payments = work.createTask(project.id, { kind: 'task', storyId: null, title: 'Payments', description: 'Stripe checkout' });

    lane.request(payments.id);
    await lane.idle();
    scheduler.pause();
    await scheduler.tick();

    const details = work.details(payments.id);
    expect(details.task).toMatchObject({ triage: 'done', triageSummary: 'Adds Stripe checkout.', touches: ['src/payments/**'], pipelineId: 'feature', status: 'blocked' });
    expect(details.requirements.map((r) => [r.kind, r.label, r.met])).toEqual([
      ['manual', '#3 Create a Stripe API key', false],
      ['code', '#1 Users', false],
    ]);
    expect(work.queries.task(details.requirements[0]!.ref!.id)).toMatchObject({ kind: 'manual', status: 'todo', description: 'Dashboard → Developers → API keys' });
    expect(decisions.queries.forTask(payments.id)[0]).toMatchObject({
      kind: 'triage',
      outcome: 'queue',
      actor: { kind: 'agent', agentId: 'triage' },
      inputs: expect.objectContaining({ notes: ['#99 does not exist; ignored.'] }),
    });

    // the agent read the base branch in a worktree of its own, removed afterwards
    expect(runtime.calls[0]?.agent.id).toBe('triage');
    expect(runtime.calls[0]?.prompt).toContain('- #1 [backlog] Users');
    expect(runtime.calls[0]?.prompt).toContain('- feature: Feature.');
    expect(runtime.calls[0]?.cwd.startsWith(join(dir, 'triage'))).toBe(true);
    expect(readdirSync(join(dir, 'triage'))).toEqual([]);
    expect(sh(root, 'worktree', 'list').trim().split('\n')).toHaveLength(1);
    expect(users.id).toBeTruthy();
  });

  it('triages new tasks by itself, but not the manual tasks it creates', async () => {
    const { work, triage: lane, runtime, project } = await setup(() => triage({ manualTasks: [{ title: 'Key', description: 'd', reason: 'r' }] }), true);
    const task = work.createTask(project.id, { kind: 'task', storyId: null, title: 'Payments', description: '' });
    await new Promise((r) => setTimeout(r, 0));
    await lane.idle();

    expect(work.queries.task(task.id)?.triage).toBe('done');
    expect(runtime.calls).toHaveLength(1);
  });

  it('leaves the task in the backlog when triage fails, and can try again', async () => {
    let fail = true;
    const { work, triage: lane, project } = await setup(() => (fail ? { output: { nope: 1 } } : triage()));
    const task = work.createTask(project.id, { kind: 'task', storyId: null, title: 'Payments', description: '' });

    lane.request(task.id);
    await lane.idle();
    expect(work.queries.task(task.id)).toMatchObject({ status: 'backlog', triage: 'failed' });
    expect(work.details(task.id).history.at(-1)).toMatchObject({ type: 'triage.failed', data: { error: expect.stringContaining('valid triage') } });

    fail = false;
    lane.request(task.id);
    await lane.idle();
    expect(work.queries.task(task.id)).toMatchObject({ status: 'ready', triage: 'done' });
  });

  it('refuses manual tasks and tasks past the backlog', async () => {
    const { work, triage: lane, project } = await setup(() => triage());
    const manual = work.createTask(project.id, { kind: 'manual', storyId: null, title: 'Key', description: '' });
    expect(() => lane.request(manual.id)).toThrow(expect.objectContaining({ code: 'NOT_AN_AGENT_TASK' }));
    const queued = work.queue(work.createTask(project.id, { kind: 'task', storyId: null, title: 'T', description: '' }).id);
    expect(() => lane.request(queued.id)).toThrow(expect.objectContaining({ code: 'NOT_IN_BACKLOG' }));
  });
});
