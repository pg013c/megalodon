import { join } from 'node:path';
import {
  apiErrorSchema,
  defaultPolicies,
  runEvents,
  scorecardSchema,
  type AgentScore,
  type PipelineScore,
  type Policies,
  type ReviewOutput,
  type Scorecard,
} from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import type { AgentRunInput } from '../runtime/types';
import { initRepo } from '../test/repo';
import { ScriptedRuntime, type Script } from '../test/scriptedRuntime';
import { createTestServer, url } from '../test/server';
import { useTempDir } from '../test/tempDir';
import { ScorecardQueries } from './projection';
import { ScorecardService } from './service';

const tempDir = useTempDir();

const approve: ReviewOutput = { verdict: 'approve', score: 8, summary: 'Looks right.', findings: [] };
const changes: ReviewOutput = { verdict: 'request_changes', score: 4, summary: 'Missing newline.', findings: [] };

/** Per agent, `call` counted from 1 for that agent. */
type Agents = Partial<Record<string, (input: AgentRunInput, call: number) => Script>>;

/** Scripted agents: the planner plans, the implementer writes the file its task title names, the reviewer approves. */
async function setup(agents: Agents = {}, options: { now?: () => Date } = {}) {
  const calls = new Map<string, number>();
  const runtime = new ScriptedRuntime((input) => {
    const id = input.agent.id;
    calls.set(id, (calls.get(id) ?? 0) + 1);
    const own = agents[id];
    if (own) return own(input, calls.get(id)!);
    if (id === 'triage') return { output: { summary: 's', touches: [], pipeline: 'feature', dependsOn: [], manualTasks: [] } };
    if (id === 'planner') return { output: { summary: 'Plan it.', steps: ['do'], touches: [], risks: [] } };
    if (id === 'reviewer') return { output: approve };
    return { files: { [fileOf(input)]: 'hi\n' } };
  });
  const server = createTestServer(tempDir(), runtime);
  const project = await server.projects.connect(initRepo(join(tempDir(), 'shop')));
  const scorecard = new ScorecardService({ queries: new ScorecardQueries(server.db), library: server.library, ...options });
  const task = (title: string, projectId = project.id) => server.work.createTask(projectId, { kind: 'task', storyId: null, title, description: '' });
  const run = async (title: string, source: { pipelineId: string } | { agentId: string } = { pipelineId: 'feature' }, projectId = project.id) => {
    const t = task(title, projectId);
    const started = await server.runs.start(t.id, source);
    await server.runs.idle();
    return { task: t, run: server.runs.queries.run(started.id)! };
  };
  const policies = (p: Partial<Policies>) => server.projects.updateSettings(project.id, { ...server.projects.get(project.id).settings, policies: { ...defaultPolicies, ...p } });
  return { ...server, project, scorecard, task, run, policies };
}

const fileOf = (input: AgentRunInput) => `${/Task #\d+ in \w+: (\S+)/.exec(input.prompt)?.[1] ?? 'x'}.txt`;

const agent = (card: Scorecard, id: string): AgentScore => {
  const rows = card.agents.filter((a) => a.agentId === id && a.current);
  expect(rows).toHaveLength(1);
  return rows[0]!;
};
const pipeline = (card: Scorecard, id: string): PipelineScore => {
  const rows = card.pipelines.filter((p) => p.pipelineId === id && p.current);
  expect(rows).toHaveLength(1);
  return rows[0]!;
};

describe('ScorecardService: agents', () => {
  it('counts success and rework, and credits review scores to the implementer', async () => {
    const server = await setup({
      // the first attempt writes nothing, so the checks fail
      implementer: (_, call) => (call === 1 ? {} : { files: { 'hello.txt': 'hi\n' } }),
      reviewer: (_, call) => ({ output: call === 1 ? changes : approve }),
    });
    await server.projects.updateSettings(server.project.id, {
      ...server.project.settings,
      checks: [{ name: 'hello', command: 'test -f hello.txt', required: true, timeoutSec: 30 }],
      maxFixPasses: 2,
    });
    const { run } = await server.run('hello');
    expect(run.status).toBe('succeeded');

    const card = server.scorecard.view('30d', null);
    expect(agent(card, 'implementer')).toMatchObject({
      name: 'Implementer',
      runs: 1,
      steps: 3,
      succeeded: 3,
      successRate: 1,
      rework: 2,
      reviewed: 2,
      reviewScore: 6,
      costUsd: expect.closeTo(0.03, 6),
      avgCostUsd: expect.closeTo(0.01, 6),
      avgDurationMs: 10,
      decisions: 0,
      overridden: 0,
    });
    expect(agent(card, 'reviewer')).toMatchObject({ steps: 2, rework: 0, successRate: 1, reviewed: 0, reviewScore: null, decisions: 2, overridden: 0 });
    expect(agent(card, 'planner')).toMatchObject({ steps: 1, rework: 0, reviewed: 0 });
    expect(pipeline(card, 'feature')).toMatchObject({ name: 'Feature', runs: 1, finished: 1, merged: 0, avgAttempts: 3 });
  });

  it('counts failed attempts and leaves stopped ones out', async () => {
    const server = await setup({
      implementer: (input, call) => (call === 1 ? { files: { [fileOf(input)]: 'hi\n' } } : call === 2 ? { ok: false, error: 'error_max_turns' } : { hang: true }),
    });
    expect((await server.run('a', { agentId: 'implementer' })).run.status).toBe('succeeded');
    expect((await server.run('b', { agentId: 'implementer' })).run.status).toBe('failed');
    const t = server.task('c');
    const stopped = await server.runs.start(t.id, { agentId: 'implementer' });
    server.runs.stop(stopped.id);
    await server.runs.idle();
    expect(server.runs.queries.run(stopped.id)?.status).toBe('cancelled');
    expect(server.runs.queries.steps(stopped.id).map((s) => s.status)).toEqual(['cancelled']);

    const card = server.scorecard.view('30d', null);
    // 1 succeeded of 2 that ended: the stopped attempt is not in the denominator (that would be 1/3)
    expect(agent(card, 'implementer')).toMatchObject({ runs: 3, steps: 3, succeeded: 1, successRate: 0.5, rework: 0 });
    expect(pipeline(card, 'agent:implementer')).toMatchObject({ name: 'Implementer', runs: 3, finished: 3, merged: 0, mergedUnattended: 0, unattendedRate: 0 });
  });

  it('counts an attempt started over after a restart once, keeping its rework', async () => {
    const server = await setup();
    const t = server.task('r');
    const run = (data: Record<string, unknown>) => ({ stream: 'run:r', data: { runId: 'r', ...data }, actor: { kind: 'system' as const } });
    const step = (stepId: string, attempt: number, kind: 'agent' | 'check') =>
      run({ stepId, attempt, index: 0, kind, name: stepId, agentId: kind === 'agent' ? 'implementer' : null, agentVersion: kind === 'agent' ? 'v' : null });
    const done = (stepId: string, attempt: number, status: 'succeeded' | 'failed') =>
      run({ stepId, attempt, status, usage: { costUsd: 0.1, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, durationMs: 5, numTurns: 1, result: null, error: null });
    server.store.append([
      { type: runEvents.started, ...run({ taskId: t.id, projectId: server.project.id, pipelineId: 'feature', pipelineVersion: 'v', branch: 'b', worktreePath: '/nowhere', baseRef: 'main', baseSha: 'x', plan: [] }) },
      { type: runEvents.stepStarted, ...step('implement', 1, 'agent') },
      { type: runEvents.stepCompleted, ...done('implement', 1, 'succeeded') },
      { type: runEvents.stepStarted, ...step('checks', 1, 'check') },
      { type: runEvents.stepCompleted, ...done('checks', 1, 'failed') },
      server.decisions.event({ taskId: t.id, runId: 'r', stepId: 'checks', kind: 'retry', outcome: 'retry implement', rationale: 'r', alternatives: [], inputs: { next: 'implement' }, actor: { kind: 'policy', policy: 'p' } }),
      // attempt 2 is rework; Megalodon stops before it completes and starts it over as attempt 3
      { type: runEvents.stepStarted, ...step('implement', 2, 'agent') },
      { type: runEvents.stepStarted, ...step('implement', 3, 'agent') },
      { type: runEvents.stepCompleted, ...done('implement', 3, 'succeeded') },
      { type: runEvents.stepStarted, ...step('checks', 2, 'check') },
      { type: runEvents.stepCompleted, ...done('checks', 2, 'succeeded') },
      { type: runEvents.completed, ...run({ status: 'succeeded', commitSha: null, error: null }) },
    ]);

    const card = server.scorecard.view('30d', null);
    expect(card.agents.find((a) => a.agentVersion === 'v')).toMatchObject({ steps: 2, succeeded: 2, successRate: 1, rework: 1 });
    expect(card.pipelines.find((p) => p.pipelineVersion === 'v')).toMatchObject({ runs: 1, finished: 1, avgAttempts: 2, avgCostUsd: expect.closeTo(0.4, 6), avgDurationMs: 20 });
  });

  it('counts the decisions of an agent the operator overrode', async () => {
    const server = await setup();
    const { run } = await server.run('a');
    const verdict = server.decisions.queries.forRun(run.id).find((d) => d.kind === 'review.verdict')!;
    server.decisions.override(verdict.id, 'request_changes', 'Not good enough.');

    const t = server.task('b');
    server.triage.request(t.id);
    await server.triage.idle();
    const triaged = server.decisions.queries.forTask(t.id).find((d) => d.kind === 'triage')!;
    // triage has no alternatives to pick from yet, so the override is recorded directly
    server.store.append([
      server.decisions.event(
        { taskId: t.id, runId: null, stepId: null, kind: 'triage', outcome: 'retriaged', rationale: 'Wrong pipeline.', alternatives: [], actor: { kind: 'operator' } },
        triaged.id,
      ),
    ]);

    const card = server.scorecard.view('30d', null);
    // the original verdict still scores the implementer
    expect(agent(card, 'reviewer')).toMatchObject({ decisions: 1, overridden: 1 });
    expect(agent(card, 'implementer')).toMatchObject({ reviewed: 1, reviewScore: 8 });
    expect(agent(card, 'triage')).toMatchObject({ name: 'Triage', runs: 0, steps: 0, successRate: null, avgDurationMs: null, decisions: 1, overridden: 1 });
  });
});

describe('ScorecardService: pipelines', () => {
  it('tells runs merged without the operator from runs the operator stepped into', async () => {
    const server = await setup();
    const first = await server.run('a');
    await server.merges.tick();
    expect(server.work.queries.task(first.task.id)?.status).toBe('done');

    let card = server.scorecard.view('30d', null);
    expect(pipeline(card, 'feature')).toMatchObject({ runs: 1, finished: 1, merged: 1, mergedUnattended: 1, unattendedRate: 1, avgAttempts: 1 });

    // the project holds every merge for the operator, who merges by hand
    await server.policies({ merge: { mode: 'operator', minScore: 7 } });
    const second = await server.run('b');
    expect(server.work.queries.task(second.task.id)?.status).toBe('needs_you');
    server.merges.enqueue(second.task.id);
    await server.merges.tick();
    expect(server.work.queries.task(second.task.id)?.status).toBe('done');

    card = server.scorecard.view('30d', null);
    expect(pipeline(card, 'feature')).toMatchObject({
      runs: 2,
      finished: 2,
      merged: 2,
      mergedUnattended: 1,
      unattendedRate: 0.5,
      avgAttempts: 1,
      costUsd: expect.closeTo(0.06, 6),
      avgCostUsd: expect.closeTo(0.03, 6),
      avgDurationMs: expect.any(Number),
    });
  });
});

describe('ScorecardService: versions and filters', () => {
  it('flags the current library version and lists only versions with data', async () => {
    const server = await setup();
    await server.run('a');
    const t = server.task('old');
    server.store.append([
      {
        type: runEvents.started,
        stream: 'run:old',
        data: { runId: 'old', taskId: t.id, projectId: server.project.id, pipelineId: 'feature', pipelineVersion: 'old', branch: 'b', worktreePath: '/nowhere', baseRef: 'main', baseSha: 'x', plan: [] },
        actor: { kind: 'operator' },
      },
      {
        type: runEvents.stepStarted,
        stream: 'run:old',
        data: { runId: 'old', stepId: 'implement', attempt: 1, index: 0, kind: 'agent', name: 'Implementer', agentId: 'implementer', agentVersion: 'old' },
        actor: { kind: 'system' },
      },
      {
        type: runEvents.stepCompleted,
        stream: 'run:old',
        data: { runId: 'old', stepId: 'implement', attempt: 1, status: 'failed', usage: { costUsd: 0.5, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, durationMs: 100, numTurns: 1, result: null, error: 'x' },
        actor: { kind: 'system' },
      },
    ]);

    const card = server.scorecard.view('30d', null);
    const current = server.library.agent('implementer').version;
    expect(card.agents.filter((a) => a.agentId === 'implementer').map((a) => [a.agentVersion, a.current, a.successRate])).toEqual([
      [current, true, 1],
      ['old', false, 0],
    ]);
    expect(card.pipelines.map((p) => [p.pipelineId, p.pipelineVersion === 'old' ? 'old' : 'current', p.current])).toEqual([
      ['feature', 'current', true],
      ['feature', 'old', false],
    ]);
    expect(card.agents.map((a) => a.agentId)).not.toContain('resolver');
    expect(card.agents.map((a) => a.agentId)).not.toContain('chat');
  });

  it('filters by period and project', async () => {
    let now = new Date();
    const server = await setup({}, { now: () => now });
    await server.run('a');
    const other = await server.projects.connect(initRepo(join(tempDir(), 'blog')));
    await server.run('b', { agentId: 'implementer' }, other.id);

    expect(server.scorecard.view('24h', null).pipelines.map((p) => p.pipelineId)).toEqual(['agent:implementer', 'feature']);
    expect(server.scorecard.view('24h', server.project.id).pipelines.map((p) => p.pipelineId)).toEqual(['feature']);
    expect(agent(server.scorecard.view('all', other.id), 'implementer')).toMatchObject({ runs: 1, steps: 1 });

    now = new Date(Date.now() + 2 * 86_400_000);
    expect(server.scorecard.view('24h', null)).toMatchObject({ agents: [], pipelines: [] });
    expect(server.scorecard.view('7d', null).pipelines).toHaveLength(2);
  });

  it('rebuilds from the log to the same scorecard, alone or with the other projections', async () => {
    const server = await setup({ reviewer: (_, call) => ({ output: call === 1 ? changes : approve }) });
    const { run } = await server.run('a');
    await server.merges.tick();
    const verdict = server.decisions.queries.forRun(run.id).find((d) => d.kind === 'review.verdict')!;
    server.decisions.override(verdict.id, 'approve', 'Fine by me.');
    const before = server.scorecard.view('all', null);
    expect(agent(before, 'implementer')).toMatchObject({ rework: 1, reviewed: 2 });

    server.store.rebuild();
    expect(server.scorecard.view('all', null)).toEqual(before);
    server.db.exec('DELETE FROM scorecard_runs; DELETE FROM scorecard_steps; DELETE FROM scorecard_decisions;');
    expect(new ScorecardQueries(server.db).needsBackfill()).toBe(true);
    server.store.rebuild(['scorecard']);
    expect(server.scorecard.view('all', null)).toEqual(before);
    expect(new ScorecardQueries(server.db).needsBackfill()).toBe(false);
  });
});

describe('GET /api/scorecard', () => {
  it('returns the scorecard, for one project or all', async () => {
    const server = await setup();
    await server.run('a');
    const all = scorecardSchema.parse(await (await server.app.request(url('/api/scorecard'))).json());
    expect(all).toMatchObject({ period: '30d', projectId: null });
    expect(agent(all, 'implementer').steps).toBe(1);

    const one = scorecardSchema.parse(await (await server.app.request(url(`/api/scorecard?projectId=${server.project.id}&period=all`))).json());
    expect(one).toMatchObject({ period: 'all', projectId: server.project.id });
  });

  it('refuses an unknown period or project', async () => {
    const { app } = await setup();
    const period = await app.request(url('/api/scorecard?period=1y'));
    expect(period.status).toBe(400);
    expect(apiErrorSchema.parse(await period.json()).error).toMatchObject({ code: 'INVALID_REQUEST', message: 'period must be one of 24h, 7d, 30d, all' });

    const project = await app.request(url('/api/scorecard?projectId=nope'));
    expect(project.status).toBe(404);
    expect(apiErrorSchema.parse(await project.json()).error.code).toBe('PROJECT_NOT_FOUND');
  });
});
