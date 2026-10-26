import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
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
});
