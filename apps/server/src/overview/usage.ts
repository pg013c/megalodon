import { mergeEvents, runEvents, workEvents, type StoredEvent } from '@megalodon/contracts';
import type { Database } from '../db';
import type { Projection } from '../events/projection';

/**
 * What agents spent, per project and time (table from migration 8): every agent step of a run,
 * every triage and every conflict resolution.
 */
export class UsageProjection implements Projection {
  readonly name = 'usage';

  reset(db: Database): void {
    db.exec('DELETE FROM agent_usage');
  }

  apply(db: Database, event: StoredEvent): void {
    const data = event.data as Record<string, unknown>;
    let row: { projectId: string | undefined; kind: string; cost: number; duration: number } | null = null;
    if (event.type === runEvents.stepCompleted) {
      const step = db.prepare('SELECT s.kind, r.project_id FROM run_steps s JOIN runs r ON r.id = s.run_id WHERE s.run_id = ? AND s.step_id = ? AND s.attempt = ?').get(
        String(data.runId),
        String(data.stepId),
        Number(data.attempt ?? 1),
      ) as { kind: string; project_id: string } | undefined;
      if (step?.kind === 'agent') {
        const usage = data.usage as { costUsd: number };
        row = { projectId: step.project_id, kind: 'run', cost: usage.costUsd, duration: Number(data.durationMs ?? 0) };
      }
    } else if (event.type === workEvents.triageCompleted || event.type === workEvents.triageFailed) {
      row = { projectId: this.project(db, data.taskId), kind: 'triage', cost: Number(data.costUsd ?? 0), duration: Number(data.durationMs ?? 0) };
    } else if (event.type === mergeEvents.resolved) {
      const usage = data.usage as { costUsd: number } | undefined;
      row = { projectId: this.project(db, data.taskId), kind: 'resolver', cost: usage?.costUsd ?? 0, duration: Number(data.durationMs ?? 0) };
    }
    if (!row?.projectId) return;
    db.prepare('INSERT INTO agent_usage (seq, project_id, kind, cost_usd, duration_ms, at) VALUES (?, ?, ?, ?, ?, ?)').run(
      event.seq,
      row.projectId,
      row.kind,
      row.cost,
      row.duration,
      event.at,
    );
  }

  private project(db: Database, taskId: unknown): string | undefined {
    return (db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(String(taskId)) as { project_id: string } | undefined)?.project_id;
  }
}

export class UsageQueries {
  constructor(private readonly db: Database) {}

  /** Cost and agent time of a project since `since` (ISO), or ever. */
  spent(projectId: string, since: string | null): { costUsd: number; agentTimeMs: number } {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(duration_ms), 0) AS time FROM agent_usage WHERE project_id = ? AND at >= ?')
      .get(projectId, since ?? '') as { cost: number; time: number };
    return { costUsd: row.cost, agentTimeMs: row.time };
  }
}
