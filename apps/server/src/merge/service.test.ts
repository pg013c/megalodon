import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReviewOutput } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import type { AgentRunInput } from '../runtime/types';
import { initRepo, sh } from '../test/repo';
import { ScriptedRuntime, type Script } from '../test/scriptedRuntime';
import { createTestServer } from '../test/server';
import { useTempDir } from '../test/tempDir';

const tempDir = useTempDir();

const approve: ReviewOutput = { verdict: 'approve', score: 9, summary: 'Good.', findings: [] };
const changes: ReviewOutput = { verdict: 'request_changes', score: 3, summary: 'No.', findings: [] };

type Agents = Partial<Record<'implementer' | 'reviewer' | 'resolver', (input: AgentRunInput, call: number) => Script>>;

/** The feature pipeline with scripted agents; each implementer call writes the file its task title names. */
async function setup(agents: Agents = {}) {
  const runtime = new ScriptedRuntime((input, call) => {
    const own = agents[input.agent.id as keyof Agents];
    if (own) return own(input, call);
    if (input.agent.id === 'planner') return { output: { summary: 's', steps: [], touches: [], risks: [] } };
    if (input.agent.id === 'reviewer') return { output: approve };
    const file = /Task #\d+ in \w+: (\S+)/.exec(input.prompt)?.[1] ?? 'x.txt';
    return { files: { [file]: `${file}\n` } };
  });
  const server = createTestServer(tempDir(), runtime);
  const root = initRepo(join(tempDir(), 'shop'), { 'README.md': '# shop\n', 'shared.txt': 'base\n' });
  const project = await server.projects.connect(root);
  const finished = async (title: string) => {
    const task = server.work.createTask(project.id, { kind: 'task', storyId: null, title, description: '' });
    await server.runs.start(task.id, { pipelineId: 'feature' });
    await server.runs.idle();
    return server.work.queries.task(task.id)!;
  };
  const status = (id: string) => server.work.queries.task(id)?.status;
  return { ...server, runtime, root, project, finished, status };
}

describe('MergeService', () => {
  it('merges an approved task into the checkout, cleans up and marks it done', async () => {
    const { merges, root, finished, status, runs, work } = await setup();
    const task = await finished('a.txt');
    expect(task.status).toBe('merging');
    const run = runs.forTask(task.id)[0]!;

    await merges.tick();

    expect(status(task.id)).toBe('done');
    expect(work.queries.task(task.id)?.statusReason).toMatch(/^Merged as [0-9a-f]{8}$/);
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('a.txt\n');
    expect(sh(root, 'log', '-1', '--format=%s').trim()).toBe('Merge #1 a.txt');
    expect(sh(root, 'status', '--porcelain')).toBe('');
    expect(existsSync(run.worktreePath)).toBe(false);
    expect(sh(root, 'branch', '--list', run.branch)).toBe('');
    expect(work.details(task.id).history.map((h) => h.type)).toEqual(expect.arrayContaining(['merge.started', 'merge.completed']));
  });

  it('brings a branch behind the base up to date, re-runs the checks, then merges', async () => {
    const { merges, root, finished, status, projects, project } = await setup();
    await projects.updateSettings(project.id, { ...project.settings, checks: [{ name: 'both', command: 'test -f a.txt && test -f b.txt', required: false, timeoutSec: 30 }] });
    const a = await finished('a.txt');
    const b = await finished('b.txt');

    await merges.tick();

    expect([status(a.id), status(b.id)]).toEqual(['done', 'done']);
    expect(existsSync(join(root, 'a.txt')) && existsSync(join(root, 'b.txt'))).toBe(true);
  });

  it('lets the resolver settle conflicts with the base', async () => {
    const { merges, root, finished, status, runtime } = await setup({
      implementer: (input) => ({ files: { 'shared.txt': `${/: (\S+)/.exec(input.prompt)?.[1]}\n` } }),
      resolver: (input) => {
        writeFileSync(join(input.cwd, 'shared.txt'), 'first\nsecond\n');
        return {};
      },
    });
    const first = await finished('first');
    const second = await finished('second');

    await merges.tick();

    expect([status(first.id), status(second.id)]).toEqual(['done', 'done']);
    expect(readFileSync(join(root, 'shared.txt'), 'utf8')).toBe('first\nsecond\n');
    expect(runtime.calls.filter((c) => c.agent.id === 'resolver')).toHaveLength(1);
  });

  it('gives up after two resolver attempts and hands the task to the operator', async () => {
    const { merges, finished, status, runtime, work, runs } = await setup({
      implementer: (input) => ({ files: { 'shared.txt': `${/: (\S+)/.exec(input.prompt)?.[1]}\n` } }),
      resolver: () => ({}),
    });
    const first = await finished('first');
    const second = await finished('second');

    await merges.tick();

    expect([status(first.id), status(second.id)]).toEqual(['done', 'needs_you']);
    expect(work.queries.task(second.id)?.statusReason).toBe('Conflicts with main the resolver could not settle: shared.txt');
    expect(runtime.calls.filter((c) => c.agent.id === 'resolver')).toHaveLength(2);
    // the worktree is back to the branch's own state
    expect(sh(runs.forTask(second.id)[0]!.worktreePath, 'status', '--porcelain')).toBe('');
  });

  it('waits while the checkout is dirty or off the base, and continues when it is clean', async () => {
    const { merges, root, finished, status, scheduler } = await setup();
    const task = await finished('a.txt');
    writeFileSync(join(root, 'README.md'), '# edited\n');

    await merges.tick();
    expect(status(task.id)).toBe('merging');
    expect(merges.blocks()).toEqual([expect.objectContaining({ projectName: 'shop', reason: expect.stringContaining('uncommitted changes (README.md)') })]);
    expect(scheduler.view().mergeBlocked).toHaveLength(1);

    sh(root, 'checkout', '-q', 'README.md');
    sh(root, 'checkout', '-q', '-b', 'mine');
    await merges.tick();
    expect(merges.blocks()[0]?.reason).toContain('switch back to main');

    sh(root, 'checkout', '-q', 'main');
    await merges.tick();
    expect(status(task.id)).toBe('done');
    expect(merges.blocks()).toEqual([]);
  });

  it('holds a task whose review did not pass, until the operator overrides the gate', async () => {
    const { merges, finished, status, decisions, runs } = await setup({ reviewer: () => ({ output: changes }) });
    const rejected = await finished('a.txt');
    expect(status(rejected.id)).toBe('needs_you');

    // overriding the failed gate sends the task to the queue
    const gate = decisions.queries.forRun(runs.forTask(rejected.id)[0]!.id).filter((d) => d.kind === 'gate').at(-1)!;
    decisions.override(gate.id, 'pass', 'The finding is wrong.');
    expect(status(rejected.id)).toBe('merging');
    await merges.tick();
    expect(status(rejected.id)).toBe('done');

  });

  it('holds sensitive changes and merges them on request', async () => {
    const { merges, finished, status, projects, project, decisions, runs, work } = await setup();
    await projects.updateSettings(project.id, { ...project.settings, sensitivePaths: ['secret*'] });
    const task = await finished('secret.txt');
    expect(work.queries.task(task.id)).toMatchObject({ status: 'needs_you', statusReason: expect.stringContaining('sensitive paths (secret.txt)') });
    expect(decisions.queries.effective(runs.forTask(task.id)[0]!.id, 'merge')?.outcome).toBe('hold');

    merges.enqueue(task.id);
    await merges.tick();
    expect(status(task.id)).toBe('done');
  });

  it('makes dependants ready once their dependency is merged', async () => {
    const { merges, finished, work, project, scheduler } = await setup();
    const users = await finished('users.txt');
    const payments = work.createTask(project.id, { kind: 'task', storyId: null, title: 'Payments', description: '' });
    work.addDependency(payments.id, { kind: 'code', target: { type: 'task', id: users.id }, description: '', command: null });
    work.queue(payments.id);
    scheduler.pause();
    await scheduler.tick();
    expect(work.queries.task(payments.id)?.status).toBe('blocked');

    await merges.tick();
    await scheduler.tick();
    expect(work.queries.task(payments.id)?.status).toBe('ready');
  });

  it('undoes a merge a restart left in the checkout, then merges again', async () => {
    const { merges, root, finished, status, runs } = await setup();
    const task = await finished('a.txt');
    const run = runs.forTask(task.id)[0]!;
    // as if the server stopped in the middle of merging in the checkout
    sh(root, 'merge', '--no-ff', '--no-commit', run.branch);
    expect(sh(root, 'status', '--porcelain')).not.toBe('');

    await merges.recover();

    expect(status(task.id)).toBe('done');
    expect(sh(root, 'log', '-1', '--format=%s').trim()).toBe('Merge #1 a.txt');
  });

  it('marks a task done when its merge landed before a restart', async () => {
    const { merges, root, finished, status, runs } = await setup();
    const task = await finished('a.txt');
    sh(root, 'merge', '--no-ff', '-m', 'landed', runs.forTask(task.id)[0]!.branch);

    await merges.recover();
    expect(status(task.id)).toBe('done');
  });
});
