import { join } from 'node:path';
import { apiErrorSchema, overviewSchema } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import type { AgentRunInput } from '../runtime/types';
import { initRepo } from '../test/repo';
import { ScriptedRuntime, type Script } from '../test/scriptedRuntime';
import { createTestServer, url } from '../test/server';
import { useTempDir } from '../test/tempDir';
import { UsageQueries } from './usage';

const tempDir = useTempDir();

/** Agents of project "shop" finish; agents of project "blog" hang, so its task stays running. */
function script(input: AgentRunInput): Script {
  if (input.prompt.includes(' in blog:')) return { hang: true };
  if (input.agent.id === 'triage') return { output: { summary: 's', touches: [], pipeline: 'feature', dependsOn: [], manualTasks: [] }, costUsd: 0.05 };
  if (input.agent.id === 'planner') return { output: { summary: 's', steps: [], touches: [], risks: [] }, costUsd: 0.1 };
  if (input.agent.id === 'reviewer') return { output: { verdict: 'approve', score: 9, summary: 'ok', findings: [] }, costUsd: 0.1 };
  return { files: { 'a.txt': 'a\n' }, costUsd: 0.2 };
}

async function setup() {
  const server = createTestServer(tempDir(), new ScriptedRuntime(script));
  const shop = await server.projects.connect(initRepo(join(tempDir(), 'shop')));
  const blog = await server.projects.connect(initRepo(join(tempDir(), 'blog')));
  return { ...server, shop, blog };
}

const get = async (app: Awaited<ReturnType<typeof setup>>['app'], period = '7d') =>
  overviewSchema.parse(await (await app.request(url(`/api/overview?period=${period}`))).json());

describe('overview', () => {
  it('shows each project: counts, progress, what runs now and on which step, spend, merges and what needs you', async () => {
    const { app, work, runs, triage, merges, shop, blog } = await setup();
    const done = work.createTask(shop.id, { kind: 'task', storyId: null, title: 'Done', description: '' });
    triage.request(done.id);
    await triage.idle();
    await runs.start(done.id, { pipelineId: 'feature' });
    await runs.idle();
    await merges.tick();
    work.createTask(shop.id, { kind: 'manual', storyId: null, title: 'Key', description: '' });
    work.queue(work.createTask(shop.id, { kind: 'task', storyId: null, title: 'Later', description: '' }).id);

    const busy = work.createTask(blog.id, { kind: 'task', storyId: null, title: 'Busy', description: '' });
    await runs.start(busy.id, { pipelineId: 'feature' });

    const view = await get(app);
    expect(view.needsYou).toEqual({ total: 1, byKind: { manual: 1 } });
    const [first, second] = view.projects;
    // the project with work or waiting items comes first; both have one, so by name
    expect(first?.project.name).toBe('blog');
    expect(first?.active).toEqual([expect.objectContaining({ step: 'Planner', attempt: 1, task: expect.objectContaining({ title: 'Busy' }) })]);
    expect(second).toMatchObject({
      counts: { done: 1, ready: 1 },
      done: 1,
      total: 2,
      needsYou: 1,
      merged: 1,
      mergeBlocked: null,
    });
    expect(second?.costUsd).toBeCloseTo(0.45); // triage 0.05 + plan 0.1 + implement 0.2 + review 0.1
    expect(second?.agentTimeMs).toBe(40);
    expect(view.totals).toMatchObject({ merged: 1, running: 1 });
    await runs.shutdown();
  });

  it('counts only the chosen period', async () => {
    const { work, runs, shop, db, store } = await setup();
    const t = work.createTask(shop.id, { kind: 'task', storyId: null, title: 'T', description: '' });
    await runs.start(t.id, { pipelineId: 'feature' });
    await runs.idle();
    const usage = new UsageQueries(db);
    const later = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect(usage.spent(shop.id, null).costUsd).toBeCloseTo(0.4);
    expect(usage.spent(shop.id, later).costUsd).toBe(0);

    const before = usage.spent(shop.id, null);
    store.rebuild();
    expect(usage.spent(shop.id, null)).toEqual(before);
  });

  it('refuses an unknown period', async () => {
    const { app } = await setup();
    const res = await app.request(url('/api/overview?period=1y'));
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe('INVALID_REQUEST');
    expect((await get(app, 'all')).projects).toHaveLength(2);
  });
});
