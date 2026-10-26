import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultPolicies, needsYouSchema, type Policies, type ReviewOutput } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { mergeRule } from './runs/service';
import type { AgentRunInput } from './runtime/types';
import { initRepo, sh } from './test/repo';
import { ScriptedRuntime, type Script } from './test/scriptedRuntime';
import { createTestServer, url } from './test/server';
import { useTempDir } from './test/tempDir';

const tempDir = useTempDir();

type Agents = Partial<Record<string, (input: AgentRunInput) => Script>>;

const review = (score: number): ReviewOutput => ({ verdict: 'approve', score, summary: 'ok', findings: [] });

/** The feature pipeline and triage with scripted agents; the implementer writes the file named by the task title. */
async function setup(policies: Partial<Policies> = {}, agents: Agents = {}, extra: { sensitivePaths?: string[] } = {}) {
  const runtime = new ScriptedRuntime((input) => {
    const own = agents[input.agent.id];
    if (own) return own(input);
    if (input.agent.id === 'triage') return { output: { summary: 's', touches: ['src'], pipeline: 'feature', dependsOn: [], manualTasks: [] } };
    if (input.agent.id === 'planner') return { output: { summary: 'Plan it.', steps: ['do'], touches: ['src/app.ts'], risks: [] } };
    if (input.agent.id === 'reviewer') return { output: review(9) };
    const file = /Task #\d+ in \w+: (\S+)/.exec(input.prompt)?.[1] ?? 'x.txt';
    return { files: { [file]: `${file}\n` } };
  });
  const server = createTestServer(tempDir(), runtime);
  const root = initRepo(join(tempDir(), 'shop'), { 'README.md': '# shop\n', 'shared.txt': 'base\n' });
  const connected = await server.projects.connect(root);
  const project = await server.projects.updateSettings(connected.id, {
    ...connected.settings,
    sensitivePaths: extra.sensitivePaths ?? [],
    policies: { ...defaultPolicies, ...policies },
  });
  const task = (title: string) => server.work.createTask(project.id, { kind: 'task', storyId: null, title, description: '' });
  const runFeature = async (title: string) => {
    const t = task(title);
    await server.runs.start(t.id, { pipelineId: 'feature' });
    await server.runs.idle();
    return server.work.queries.task(t.id)!;
  };
  const needsYou = async () => needsYouSchema.parse(await (await server.app.request(url('/api/needs-you'))).json());
  return { ...server, runtime, root, project, task, runFeature, needsYou };
}

describe('queue policy', () => {
  it('holds a triaged task for the operator, who lets it in by overriding the decision', async () => {
    const { triage, work, task, needsYou, decisions } = await setup({ queue: { mode: 'operator' } });
    const t = task('a.txt');
    triage.request(t.id);
    await triage.idle();

    expect(work.queries.task(t.id)?.status).toBe('backlog');
    const [item] = (await needsYou()).items;
    expect(item).toMatchObject({ kind: 'queue', task: { id: t.id }, reason: 'The project asks you before queueing triaged tasks.' });

    decisions.override(item!.decisionId!, 'queue', 'Go.');
    expect(work.queries.task(t.id)?.status).toBe('ready');
  });

  it('auto_if holds only tasks with manual work', async () => {
    let manual = true;
    const { triage, work, task } = await setup({ queue: { mode: 'auto_if' } }, {
      triage: () => ({
        output: { summary: 's', touches: [], pipeline: 'feature', dependsOn: [], manualTasks: manual ? [{ title: 'Key', description: 'd', reason: 'r' }] : [] },
      }),
    });
    const held = task('a');
    triage.request(held.id);
    await triage.idle();
    manual = false;
    const queued = task('b');
    triage.request(queued.id);
    await triage.idle();
    expect([work.queries.task(held.id)?.status, work.queries.task(queued.id)?.status]).toEqual(['backlog', 'ready']);
  });
});

describe('plan policy', () => {
  it('parks the run after the plan until the operator approves it, without holding a slot', async () => {
    const { runs, work, runtime, task, needsYou, decisions } = await setup({ plan: { mode: 'operator' } });
    const t = task('a.txt');
    const run = await runs.start(t.id, { pipelineId: 'feature' });
    await runs.idle();

    expect(runs.queries.run(run.id)?.status).toBe('waiting');
    expect(runs.queries.running()).toEqual([]);
    expect(runtime.calls.map((c) => c.agent.id)).toEqual(['planner']);
    expect(work.queries.task(t.id)).toMatchObject({ status: 'needs_you', statusReason: 'The plan waits for your approval: Plan it.' });
    const [item] = (await needsYou()).items;
    expect(item).toMatchObject({ kind: 'plan', runId: run.id });

    decisions.override(item!.decisionId!, 'approve', 'Looks right.');
    await new Promise((r) => setTimeout(r, 0));
    await runs.idle();

    expect(runtime.calls.map((c) => c.agent.id)).toEqual(['planner', 'implementer', 'reviewer']);
    expect(runs.queries.run(run.id)?.status).toBe('succeeded');
    expect(work.queries.task(t.id)?.status).toBe('merging');
  });

  it('auto_if holds plans that touch sensitive paths', async () => {
    const { runs, work, task } = await setup({ plan: { mode: 'auto_if' } }, {}, { sensitivePaths: ['src/**'] });
    const t = task('a.txt');
    await runs.start(t.id, { pipelineId: 'feature' });
    await runs.idle();
    expect(work.queries.task(t.id)?.statusReason).toMatch(/^The plan waits for your approval/);
  });

  it('cancelling the task ends a parked run', async () => {
    const { runs, work, task } = await setup({ plan: { mode: 'operator' } });
    const t = task('a.txt');
    const run = await runs.start(t.id, { pipelineId: 'feature' });
    await runs.idle();
    work.cancel(t.id);
    expect(runs.queries.run(run.id)).toMatchObject({ status: 'cancelled', error: 'Task cancelled' });
  });
});

describe('merge policy', () => {
  it('operator: every finished run waits for the Merge button', async () => {
    const { runFeature, needsYou } = await setup({ merge: { mode: 'operator', minScore: 7 } });
    const t = await runFeature('a.txt');
    expect(t).toMatchObject({ status: 'needs_you', statusReason: expect.stringContaining('The project asks you to merge') });
    expect((await needsYou()).items[0]).toMatchObject({ kind: 'review', mergeable: true, decisionId: expect.any(String) });
  });

  it('auto_if: a score below the project minimum waits', async () => {
    const { runFeature } = await setup({ merge: { mode: 'auto_if', minScore: 10 } });
    expect((await runFeature('a.txt')).statusReason).toContain('the project merges by itself from 10');
  });

  it('auto: merges even sensitive changes', async () => {
    const { runFeature } = await setup({ merge: { mode: 'auto', minScore: 7 } }, {}, { sensitivePaths: ['*.txt'] });
    expect((await runFeature('a.txt')).status).toBe('merging');
  });
});

describe('conflict and push policies', () => {
  it('operator: conflicts go to the operator without the resolver', async () => {
    const { runFeature, merges, work, runtime } = await setup(
      { conflicts: { mode: 'operator', attempts: 2 } },
      { implementer: (input) => ({ files: { 'shared.txt': `${/: (\S+)/.exec(input.prompt)?.[1]}\n` } }) },
    );
    const first = await runFeature('first');
    const second = await runFeature('second');
    await merges.tick();
    expect(work.queries.task(first.id)?.status).toBe('done');
    expect(work.queries.task(second.id)?.statusReason).toBe('Conflicts with main in shared.txt; the project asks you to resolve conflicts.');
    expect(runtime.calls.some((c) => c.agent.id === 'resolver')).toBe(false);
  });

  it('auto: pushes the base after a merge, and reports a failed push', async () => {
    const { runFeature, merges, work, root } = await setup({ push: { mode: 'auto', remote: 'origin' } });
    const remote = join(tempDir(), 'remote.git');
    sh(tempDir(), 'init', '-q', '--bare', remote);
    sh(root, 'remote', 'add', 'origin', remote);
    const pushed = await runFeature('a.txt');
    await merges.tick();
    expect(work.queries.task(pushed.id)?.statusReason).toMatch(/^Merged as [0-9a-f]{8}; pushed to origin$/);
    expect(sh(remote, 'log', '-1', '--format=%s', 'main').trim()).toBe('Merge #1 a.txt');

    sh(root, 'remote', 'set-url', 'origin', join(tempDir(), 'missing.git'));
    const failed = await runFeature('b.txt');
    await merges.tick();
    expect(work.queries.task(failed.id)?.statusReason).toContain('push to origin failed');
  });
});

describe('Needs you', () => {
  it('collects manual tasks, failures, triage problems and blocked merges, oldest first', async () => {
    const { work, project, needsYou, runs, triage, merges, root } = await setup({}, { implementer: () => ({ ok: false, error: 'boom' }), triage: () => ({ output: {} }) });
    const key = work.createTask(project.id, { kind: 'manual', storyId: null, title: 'Stripe key', description: 'Create it in the dashboard.' });
    const broken = work.createTask(project.id, { kind: 'task', storyId: null, title: 'Broken', description: '' });
    await runs.start(broken.id, { pipelineId: 'feature' });
    await runs.idle();
    const untriaged = work.createTask(project.id, { kind: 'task', storyId: null, title: 'Untriaged', description: '' });
    triage.request(untriaged.id);
    await triage.idle();
    writeFileSync(join(root, 'README.md'), 'dirty\n');
    const done = work.createTask(project.id, { kind: 'task', storyId: null, title: 'Done', description: '' });
    for (const to of ['ready', 'running', 'merging']) work.transition(done.id, to, null, { kind: 'system' });
    await merges.tick();

    const view = await needsYou();
    expect(view.items.map((i) => [i.kind, i.task.title])).toEqual([
      ['manual', 'Stripe key'],
      ['failed', 'Broken'],
      ['triage', 'Untriaged'],
    ]);
    expect(view.items[0]?.reason).toBe('Create it in the dashboard.');
    expect(view.mergeBlocked).toEqual([expect.objectContaining({ reason: expect.stringContaining('uncommitted changes') })]);
    expect(key.id).toBeTruthy();
  });
});

describe('mergeRule', () => {
  const facts = { gate: 'pass', gateRationale: 'Reviewer approved with 8/10.', verdict: 'approve', score: 8, sensitive: '', branch: 'b' };
  it('applies each mode', () => {
    expect(mergeRule({ mode: 'auto_if', minScore: 7 }, facts).merge).toBe(true);
    expect(mergeRule({ mode: 'auto_if', minScore: 7 }, { ...facts, sensitive: 'secret.ts' }).merge).toBe(false);
    expect(mergeRule({ mode: 'auto_if', minScore: 7 }, { ...facts, gate: null, gateRationale: null, verdict: null, score: null }).merge).toBe(false);
    expect(mergeRule({ mode: 'auto', minScore: 7 }, { ...facts, gate: null, score: null }).merge).toBe(true);
    expect(mergeRule({ mode: 'operator', minScore: 0 }, facts).merge).toBe(false);
  });
});
