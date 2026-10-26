import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initRepo } from '../test/repo';
import { createTestServer } from '../test/server';
import { useTempDir } from '../test/tempDir';

const tempDir = useTempDir();

async function setup() {
  const server = createTestServer(tempDir());
  const project = await server.projects.connect(initRepo(join(tempDir(), 'shop')));
  const task = server.work.createTask(project.id, { kind: 'task', storyId: null, title: 'T', description: '' });
  const [event] = server.store.append([
    server.decisions.event({
      taskId: task.id,
      runId: null,
      stepId: null,
      kind: 'gate',
      outcome: 'fail',
      rationale: 'Reviewer asked for changes (4/10).',
      alternatives: ['pass', 'fail'],
      inputs: { score: 4 },
      actor: { kind: 'policy', policy: 'pipeline:feature' },
    }),
  ]);
  return { ...server, task, decisionId: (event!.data as { id: string }).id };
}

describe('DecisionService', () => {
  it('records an override as a new decision that supersedes the old one', async () => {
    const { decisions, task, decisionId } = await setup();

    const override = decisions.override(decisionId, 'pass', 'The finding is about a generated file.');

    expect(override).toMatchObject({ kind: 'gate', outcome: 'pass', overrides: decisionId, actor: { kind: 'operator' }, inputs: { score: 4 } });
    expect(decisions.queries.get(decisionId)?.supersededBy).toBe(override.id);
    expect(decisions.queries.forTask(task.id).map((d) => d.outcome)).toEqual(['fail', 'pass']);
  });

  it('refuses outcomes outside the alternatives, the same outcome, and superseded decisions', async () => {
    const { decisions, decisionId } = await setup();
    expect(() => decisions.override(decisionId, 'maybe', 'x')).toThrow(expect.objectContaining({ code: 'NOT_AN_ALTERNATIVE' }));
    expect(() => decisions.override(decisionId, 'fail', 'x')).toThrow(expect.objectContaining({ code: 'SAME_OUTCOME' }));
    decisions.override(decisionId, 'pass', 'x');
    expect(() => decisions.override(decisionId, 'pass', 'x')).toThrow(expect.objectContaining({ code: 'DECISION_SUPERSEDED' }));
  });

  it('rebuilds decisions and overrides from the log', async () => {
    const { decisions, store, task, decisionId } = await setup();
    decisions.override(decisionId, 'pass', 'x');
    const before = decisions.queries.forTask(task.id);
    store.rebuild();
    expect(decisions.queries.forTask(task.id)).toEqual(before);
  });
});
