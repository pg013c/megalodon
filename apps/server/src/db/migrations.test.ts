import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ScorecardQueries } from '../scorecard/projection';
import { useTempDir } from '../test/tempDir';
import { openDatabase } from './index';
import { migrations } from './migrations';

const tempDir = useTempDir();

describe('migrations', () => {
  it('apply in order and only once', () => {
    const path = join(tempDir(), 'm.db');
    openDatabase(path).close();
    const db = openDatabase(path);
    expect((db.prepare('SELECT id FROM migrations ORDER BY id').all() as { id: number }[]).map((r) => r.id)).toEqual(migrations.map((m) => m.id));
  });

  it('5 keeps runs and steps recorded before pipelines', () => {
    const path = join(tempDir(), 'm.db');
    const before = openDatabase(path, migrations.filter((m) => m.id <= 4));
    before.exec(`
      INSERT INTO runs (id, task_id, project_id, agent_id, status, branch, worktree_path, base_ref, base_sha, plan, started_at, created_seq)
      VALUES ('r', 't', 'p', 'implementer', 'succeeded', 'b', '/w', 'main', 'x', '[]', '2026-10-26T00:00:00Z', 1);
      INSERT INTO run_steps (run_id, step_id, idx, kind, name, agent_id, agent_version, status, started_at)
      VALUES ('r', 'agent', 0, 'agent', 'Implementer', 'implementer', 'v', 'succeeded', '2026-10-26T00:00:00Z');
    `);
    before.close();

    const after = openDatabase(path);
    expect(after.prepare('SELECT pipeline_id, pipeline_version FROM runs').get()).toEqual({ pipeline_id: 'agent:implementer', pipeline_version: 'unknown' });
    expect(after.prepare('SELECT step_id, attempt, status FROM run_steps').get()).toEqual({ step_id: 'agent', attempt: 1, status: 'succeeded' });
  });

  it('11 closes the scorecard attempts of runs that ended, and only those', () => {
    const path = join(tempDir(), 'm.db');
    const before = openDatabase(path, migrations.filter((m) => m.id <= 10));
    before.exec(`
      INSERT INTO scorecard_runs (run_id, project_id, pipeline_id, pipeline_version, status, started_at)
      VALUES ('ended', 'p', 'feature', 'v', 'failed', '2026-11-23T00:00:00Z'), ('live', 'p', 'feature', 'v', 'running', '2026-11-23T00:00:00Z');
      INSERT INTO scorecard_steps (run_id, step_id, attempt, project_id, kind, status, started_at, seq)
      VALUES ('ended', 'implement', 1, 'p', 'agent', 'succeeded', '2026-11-23T00:00:00Z', 1),
             ('ended', 'fix', 1, 'p', 'agent', 'running', '2026-11-23T00:00:00Z', 2),
             ('live', 'implement', 1, 'p', 'agent', 'running', '2026-11-23T00:00:00Z', 3);
    `);
    before.close();

    const after = openDatabase(path);
    expect(after.prepare('SELECT run_id, step_id, status FROM scorecard_steps ORDER BY seq').all()).toEqual([
      { run_id: 'ended', step_id: 'implement', status: 'succeeded' },
      { run_id: 'ended', step_id: 'fix', status: 'cancelled' },
      { run_id: 'live', step_id: 'implement', status: 'running' },
    ]);
  });

  it('12 adds the reviews table empty, and asks for a backfill when agent verdicts are in the log', () => {
    const path = join(tempDir(), 'm.db');
    const before = openDatabase(path, migrations.filter((m) => m.id <= 11));
    before.exec(`
      INSERT INTO decisions (id, task_id, run_id, step_id, kind, outcome, rationale, alternatives, inputs, actor, at, seq)
      VALUES ('d', 't', 'r', 'review', 'review.verdict', 'approve', 's', '[]', '{}', '{"kind":"agent","agentId":"reviewer","version":"v"}', '2026-11-24T00:00:00Z', 1);
      INSERT INTO scorecard_decisions (id, project_id, agent_id, agent_version, at) VALUES ('d', 'p', 'reviewer', 'v', '2026-11-24T00:00:00Z');
    `);
    before.close();

    const after = openDatabase(path);
    expect(after.prepare('SELECT COUNT(*) AS n FROM scorecard_reviews').get()).toEqual({ n: 0 });
    expect(new ScorecardQueries(after).needsBackfill()).toBe(true);
  });
});
