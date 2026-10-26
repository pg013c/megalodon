import { decisionEvents, decisionMadeSchema, type Actor, type Decision, type StoredEvent } from '@megalodon/contracts';
import type { Database } from '../db';
import type { Projection } from '../events/projection';

/** Every decision, and which ones later decisions overrode (CONCEPTS.md §7). */
export class DecisionsProjection implements Projection {
  readonly name = 'decisions';

  reset(db: Database): void {
    db.exec('DELETE FROM decisions');
  }

  apply(db: Database, event: StoredEvent): void {
    if (event.type !== decisionEvents.made) return;
    const d = decisionMadeSchema.parse(event.data);
    db.prepare(
      `INSERT INTO decisions (id, task_id, run_id, step_id, kind, outcome, rationale, alternatives, inputs, actor, at, seq, overrides)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(d.id, d.taskId, d.runId, d.stepId, d.kind, d.outcome, d.rationale, JSON.stringify(d.alternatives), JSON.stringify(d.inputs), JSON.stringify(event.actor), event.at, event.seq, d.overrides);
    if (d.overrides) db.prepare('UPDATE decisions SET superseded_by = ? WHERE id = ?').run(d.id, d.overrides);
  }
}

interface DecisionRow {
  id: string;
  task_id: string;
  run_id: string | null;
  step_id: string | null;
  kind: string;
  outcome: string;
  rationale: string;
  alternatives: string;
  inputs: string;
  actor: string;
  at: string;
  superseded_by: string | null;
  overrides: string | null;
}

export class DecisionsQueries {
  constructor(private readonly db: Database) {}

  get(id: string): Decision | null {
    const row = this.db.prepare('SELECT * FROM decisions WHERE id = ?').get(id);
    return row ? toDecision(row as unknown as DecisionRow) : null;
  }

  forTask(taskId: string): Decision[] {
    return (this.db.prepare('SELECT * FROM decisions WHERE task_id = ? ORDER BY seq').all(taskId) as unknown as DecisionRow[]).map(toDecision);
  }

  forRun(runId: string): Decision[] {
    return (this.db.prepare('SELECT * FROM decisions WHERE run_id = ? ORDER BY seq').all(runId) as unknown as DecisionRow[]).map(toDecision);
  }

  /** The decision of `kind` in effect for a run: the latest one nothing has overridden. */
  effective(runId: string, kind: string): Decision | null {
    const row = this.db
      .prepare('SELECT * FROM decisions WHERE run_id = ? AND kind = ? AND superseded_by IS NULL ORDER BY seq DESC LIMIT 1')
      .get(runId, kind);
    return row ? toDecision(row as unknown as DecisionRow) : null;
  }
}

function toDecision(row: DecisionRow): Decision {
  return {
    id: row.id,
    taskId: row.task_id,
    runId: row.run_id,
    stepId: row.step_id,
    kind: row.kind,
    outcome: row.outcome,
    rationale: row.rationale,
    alternatives: JSON.parse(row.alternatives) as string[],
    inputs: JSON.parse(row.inputs) as Record<string, unknown>,
    actor: JSON.parse(row.actor) as Actor,
    at: row.at,
    supersededBy: row.superseded_by,
    overrides: row.overrides,
  };
}
