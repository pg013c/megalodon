import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AgentRunInput } from '../runtime/types';
import { initRepo } from '../test/repo';
import { ScriptedRuntime, type Script } from '../test/scriptedRuntime';
import { createTestServer } from '../test/server';
import { useTempDir } from '../test/tempDir';

const tempDir = useTempDir();

/** Runs hang until stopped unless told otherwise, so slots stay taken. */
async function setup(script: (input: AgentRunInput) => Script = () => ({ hang: true })) {
  const runtime = new ScriptedRuntime((input) => script(input));
  const clock = { now: new Date('2026-10-26T12:00:00Z') };
  const server = createTestServer(tempDir(), runtime, { now: () => clock.now });
  const { scheduler } = server;
  const project = await server.projects.connect(initRepo(join(tempDir(), 'shop')));
  const queued = (title: string, touches: string[] = [], projectId = project.id) => {
    const task = server.work.createTask(projectId, { kind: 'task', storyId: null, title, description: '' });
    if (touches.length) server.work.setTouches(task.id, touches);
    // a single agent keeps the tests short
    server.work.setPipeline(task.id, 'feature');
    return server.work.queue(task.id);
  };
  const status = (id: string) => server.work.queries.task(id)?.status;
  return { ...server, runtime, project, queued, status, clock };
}

describe('Scheduler', () => {
  it('blocks a queued task while it waits for something, and readies it when that is met', async () => {
    const { work, scheduler, queued, status, project } = await setup();
    const key = work.createTask(project.id, { kind: 'manual', storyId: null, title: 'Stripe key', description: '' });
    const payments = queued('Payments');
    work.addDependency(payments.id, { kind: 'manual', target: { type: 'task', id: key.id }, description: '', command: null });
    await scheduler.setSlots(1);
    scheduler.pause();

    await scheduler.tick();
    expect(work.queries.task(payments.id)).toMatchObject({ status: 'blocked', statusReason: 'Waits for #1 Stripe key' });
    expect(scheduler.view().waiting[0]?.waitingFor.map((r) => r.label)).toEqual(['#1 Stripe key']);

    work.complete(key.id);
    await scheduler.tick();
    expect(status(payments.id)).toBe('ready');
  });

  it('starts the oldest ready tasks into free slots, and the next one when a slot frees', async () => {
    const { scheduler, queued, status, runs } = await setup();
    scheduler.setSlots(2);
    const a = queued('A');
    const b = queued('B');
    const c = queued('C');

    await scheduler.tick();
    expect([status(a.id), status(b.id), status(c.id)]).toEqual(['running', 'running', 'ready']);
    expect(scheduler.view().running.map((e) => e.task.title)).toEqual(['A', 'B']);

    runs.stop(runs.forTask(a.id)[0]!.id);
    while (runs.forTask(a.id)[0]?.status === 'running') await new Promise((r) => setTimeout(r, 5));
    await scheduler.tick();
    expect(status(c.id)).toBe('running');
    await runs.shutdown();
  });

  it('lets the operator move a task to the front', async () => {
    const { scheduler, queued, status, work, runs } = await setup();
    scheduler.setSlots(1);
    const a = queued('A');
    const b = queued('B');
    work.moveToFront(b.id);

    await scheduler.tick();
    expect([status(a.id), status(b.id)]).toEqual(['ready', 'running']);
    expect(work.queries.task(b.id)?.front).toBe(false);
    await runs.shutdown();
  });

  it('keeps a project within its own cap', async () => {
    const { scheduler, queued, status, projects, project, runs } = await setup();
    scheduler.setSlots(5);
    await projects.updateSettings(project.id, { ...project.settings, maxParallel: 1 });
    const a = queued('A');
    const b = queued('B');
    const other = await projects.connect(initRepo(join(tempDir(), 'blog')));
    const c = queued('C', [], other.id);

    await scheduler.tick();
    expect([status(a.id), status(b.id), status(c.id)]).toEqual(['running', 'ready', 'running']);
    await runs.shutdown();
  });

  it('never runs two tasks that touch the same files at once', async () => {
    const { scheduler, queued, status, work, runs } = await setup();
    scheduler.setSlots(5);
    const a = queued('A', ['src/payments/**']);
    const b = queued('B', ['src/payments/stripe.ts']);
    const c = queued('C', ['docs']);

    await scheduler.tick();
    expect([status(a.id), status(b.id), status(c.id)]).toEqual(['running', 'ready', 'running']);
    expect(work.details(b.id).requirements).toEqual([
      expect.objectContaining({ kind: 'collision', label: '#1 A is changing the same files', met: false }),
    ]);
    await runs.shutdown();
  });

  it("marks an external dependency met when the operator's command passes", async () => {
    const { scheduler, queued, status, work, runs } = await setup();
    const t = queued('Partner');
    work.addDependency(t.id, { kind: 'external', target: null, description: 'Partner API is up', command: 'true' });
    const failing = queued('Other');
    work.addDependency(failing.id, { kind: 'external', target: null, description: 'Never', command: 'false' });

    await scheduler.tick(); // blocks both
    await scheduler.tick(); // runs the commands
    await scheduler.tick();
    expect(status(t.id)).toBe('running');
    expect(status(failing.id)).toBe('blocked');
    await runs.shutdown();
  });

  it('starts nothing while paused', async () => {
    const { scheduler, queued, status, runs } = await setup();
    const a = queued('A');
    scheduler.pause();
    await scheduler.tick();
    expect(status(a.id)).toBe('ready');
    scheduler.resume();
    await scheduler.tick();
    expect(status(a.id)).toBe('running');
    await runs.shutdown();
  });

  it('pauses on the plan limit and puts the task back in the queue when the pause ends', async () => {
    let limited = true;
    // the scripted runtime reports a limit through the error text, as Claude Code does
    const { scheduler, queued, status, runs, work, clock } = await setup((input) => {
      if (limited) return { ok: false, error: 'usage limit reached' };
      if (input.agent.id === 'planner') return { output: { summary: 's', steps: [], touches: [], risks: [] } };
      if (input.agent.id === 'reviewer') return { output: { verdict: 'approve', score: 9, summary: 'ok', findings: [] } };
      return {};
    });
    const a = queued('A');

    await scheduler.tick();
    await runs.idle();
    expect(work.queries.task(a.id)).toMatchObject({ status: 'failed' });
    expect(work.queries.task(a.id)?.statusReason).toMatch(/^Plan limit reached/);
    expect(scheduler.state()).toMatchObject({ paused: 'plan_limit', pausedUntil: '2026-10-26T12:30:00.000Z' });

    limited = false;
    await scheduler.tick();
    expect(status(a.id)).toBe('failed');
    clock.now = new Date('2026-10-26T12:31:00Z');
    await scheduler.tick();
    await runs.idle();
    expect(scheduler.state().paused).toBeNull();
    expect(status(a.id)).toBe('needs_you');
  });
});
