import {
  decisionEvents,
  decisionMadeSchema,
  mergeCompletedSchema,
  mergeEvents,
  runCompletedSchema,
  runEvents,
  runStartedSchema,
  stepCompletedSchema,
  stepStartedSchema,
  type StoredEvent,
} from '@megalodon/contracts';
import type { Database } from '../db';
import type { Projection } from '../events/projection';

/**
 * What the scorecard counts per run, step attempt and agent decision (migration 10,
 * ADR-0032). It reads only its own tables and the task's project, so it rebuilds by itself.
 */
export class ScorecardProjection implements Projection {
  readonly name = 'scorecard';

  reset(db: Database): void {
    db.exec('DELETE FROM scorecard_runs; DELETE FROM scorecard_steps; DELETE FROM scorecard_decisions;');
  }

  apply(db: Database, event: StoredEvent): void {
    switch (event.type) {
      case runEvents.started: {
        const r = runStartedSchema.parse(event.data);
        db.prepare(
          `INSERT INTO scorecard_runs (run_id, project_id, pipeline_id, pipeline_version, status, started_at)
           VALUES (?, ?, ?, ?, 'running', ?)`,
        ).run(r.runId, r.projectId, r.pipelineId, r.pipelineVersion, event.at);
        return;
      }
      case runEvents.stepStarted: {
        const s = stepStartedSchema.parse(event.data);
        const run = db.prepare('SELECT project_id, retry_next FROM scorecard_runs WHERE run_id = ?').get(s.runId) as
          | { project_id: string; retry_next: string | null }
          | undefined;
        if (!run) return;
        // an earlier attempt of this step that never completed was cut off by a Megalodon restart:
        // this attempt starts it over and replaces it, keeping its rework
        const interrupted = db
          .prepare("SELECT MAX(rework) AS rework FROM scorecard_steps WHERE run_id = ? AND step_id = ? AND status = 'running'")
          .get(s.runId, s.stepId) as { rework: number | null };
        db.prepare("DELETE FROM scorecard_steps WHERE run_id = ? AND step_id = ? AND status = 'running'").run(s.runId, s.stepId);
        // a retry sent the run back to this step: the attempt is rework
        const rework = (s.attempt > 1 && run.retry_next === s.stepId) || interrupted.rework === 1;
        db.prepare(
          `INSERT OR REPLACE INTO scorecard_steps (run_id, step_id, attempt, project_id, kind, agent_id, agent_version, status, rework, started_at, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)`,
        ).run(s.runId, s.stepId, s.attempt, run.project_id, s.kind, s.agentId, s.agentVersion, rework ? 1 : 0, event.at, event.seq);
        // attempts count what ran, not attempt numbers a restart skipped
        db.prepare(
          `UPDATE scorecard_runs SET retry_next = CASE WHEN retry_next = ? THEN NULL ELSE retry_next END,
             attempts = MAX(attempts, (SELECT COUNT(*) FROM scorecard_steps WHERE run_id = ? AND step_id = ?))
           WHERE run_id = ?`,
        ).run(s.stepId, s.runId, s.stepId, s.runId);
        return;
      }
      case runEvents.stepCompleted: {
        const s = stepCompletedSchema.parse(event.data);
        db.prepare('UPDATE scorecard_runs SET cost_usd = cost_usd + ?, duration_ms = duration_ms + ? WHERE run_id = ?').run(s.usage.costUsd, s.durationMs, s.runId);
        db.prepare('UPDATE scorecard_steps SET status = ?, cost_usd = ?, duration_ms = ?, structured = ? WHERE run_id = ? AND step_id = ? AND attempt = ?').run(
          s.status,
          s.usage.costUsd,
          s.durationMs,
          s.output !== undefined ? 1 : 0,
          s.runId,
          s.stepId,
          s.attempt,
        );
        return;
      }
      case runEvents.completed: {
        const r = runCompletedSchema.parse(event.data);
        db.prepare('UPDATE scorecard_runs SET status = ?, ended_at = ? WHERE run_id = ?').run(r.status, event.at, r.runId);
        return;
      }
      case mergeEvents.completed: {
        const { runId } = mergeCompletedSchema.parse(event.data);
        if (runId) db.prepare('UPDATE scorecard_runs SET merged = 1 WHERE run_id = ?').run(runId);
        return;
      }
      case decisionEvents.made:
        return this.decision(db, event);
    }
  }

  private decision(db: Database, event: StoredEvent): void {
    const d = decisionMadeSchema.parse(event.data);
    const actor = event.actor;
    if (d.runId) {
      if (d.kind === 'retry' && d.outcome.startsWith('retry') && typeof d.inputs.next === 'string') {
        db.prepare('UPDATE scorecard_runs SET retry_next = ? WHERE run_id = ?').run(d.inputs.next, d.runId);
      }
      if (actor.kind === 'operator') db.prepare('UPDATE scorecard_runs SET intervened = 1 WHERE run_id = ?').run(d.runId);
      // the reviewer's own score goes to the work it reviewed: the latest attempt without an output contract
      if (d.kind === 'review.verdict' && actor.kind === 'agent' && typeof d.inputs.score === 'number') {
        db.prepare(
          `UPDATE scorecard_steps SET review_score = ? WHERE rowid = (
             SELECT rowid FROM scorecard_steps WHERE run_id = ? AND kind = 'agent' AND structured = 0 AND status = 'succeeded' ORDER BY seq DESC LIMIT 1)`,
        ).run(d.inputs.score, d.runId);
      }
    }
    if (actor.kind === 'agent') {
      const projectId = d.runId ? this.runProject(db, d.runId) : this.taskProject(db, d.taskId);
      if (projectId) {
        db.prepare('INSERT INTO scorecard_decisions (id, project_id, agent_id, agent_version, at) VALUES (?, ?, ?, ?, ?)').run(
          d.id,
          projectId,
          actor.agentId,
          actor.version,
          event.at,
        );
      }
    }
    if (d.overrides) db.prepare('UPDATE scorecard_decisions SET overridden = 1 WHERE id = ?').run(d.overrides);
  }

  private runProject(db: Database, runId: string): string | undefined {
    return (db.prepare('SELECT project_id FROM scorecard_runs WHERE run_id = ?').get(runId) as { project_id: string } | undefined)?.project_id;
  }

  private taskProject(db: Database, taskId: string): string | undefined {
    return (db.prepare('SELECT project_id FROM tasks WHERE id = ?').get(taskId) as { project_id: string } | undefined)?.project_id;
  }
}

export interface AgentStepRow {
  agentId: string;
  agentVersion: string;
  runs: number;
  steps: number;
  succeeded: number;
  ended: number;
  rework: number;
  reviewed: number;
  reviewScore: number | null;
  costUsd: number;
  avgCostUsd: number | null;
  avgDurationMs: number | null;
}

export interface AgentDecisionRow {
  agentId: string;
  agentVersion: string;
  decisions: number;
  overridden: number;
}

export interface PipelineRow {
  pipelineId: string;
  pipelineVersion: string;
  runs: number;
  finished: number;
  merged: number;
  mergedUnattended: number;
  avgAttempts: number | null;
  costUsd: number;
  avgCostUsd: number | null;
  avgDurationMs: number | null;
}

export interface RunRow {
  runId: string;
  taskId: string | null;
  taskNumber: number | null;
  taskTitle: string | null;
  projectId: string;
  projectName: string | null;
  status: string;
  startedAt: string;
  attempts: number;
  rework: number;
  reviewScore: number | null;
  costUsd: number;
  durationMs: number | null;
  merged: number;
}

const FINISHED = "status IN ('succeeded', 'failed', 'cancelled')";
// the rows each list counts: the runs behind a row share them, so the two cannot disagree (ADR-0033)
const AGENT_STEPS = "kind = 'agent' AND agent_version IS NOT NULL AND (? IS NULL OR project_id = ?) AND started_at >= ?";
const DECISIONS = '(? IS NULL OR project_id = ?) AND at >= ?';
const PIPELINE_RUNS = '(? IS NULL OR project_id = ?) AND started_at >= ?';
/** The runs behind one row, newest first. */
const RUNS_LIMIT = 100;
const RUN_DETAILS = `LEFT JOIN runs r ON r.id = picked.runId
  LEFT JOIN tasks t ON t.id = r.task_id
  LEFT JOIN projects p ON p.id = picked.projectId`;
const RUN_COLUMNS = `picked.runId, r.task_id AS taskId, t.number AS taskNumber, t.title AS taskTitle, picked.projectId, p.name AS projectName,
  picked.status, picked.startedAt, picked.attempts, picked.rework, picked.reviewScore, picked.costUsd, picked.durationMs, picked.merged`;

/** The scorecard grouped by version, for a project (or all) since `since` (ISO, or ever). */
export class ScorecardQueries {
  constructor(private readonly db: Database) {}

  agents(projectId: string | null, since: string | null): AgentStepRow[] {
    return this.db
      .prepare(
        `SELECT agent_id AS agentId, agent_version AS agentVersion, COUNT(DISTINCT run_id) AS runs, COUNT(*) AS steps,
           SUM(status = 'succeeded') AS succeeded, SUM(status IN ('succeeded', 'failed')) AS ended, SUM(rework) AS rework,
           COUNT(review_score) AS reviewed, AVG(review_score) AS reviewScore, SUM(cost_usd) AS costUsd,
           AVG(CASE WHEN status != 'running' THEN cost_usd END) AS avgCostUsd, AVG(duration_ms) AS avgDurationMs
         FROM scorecard_steps WHERE ${AGENT_STEPS}
         GROUP BY agent_id, agent_version`,
      )
      .all(projectId, projectId, since ?? '') as unknown as AgentStepRow[];
  }

  decisions(projectId: string | null, since: string | null): AgentDecisionRow[] {
    return this.db
      .prepare(
        `SELECT agent_id AS agentId, agent_version AS agentVersion, COUNT(*) AS decisions, SUM(overridden) AS overridden
         FROM scorecard_decisions WHERE ${DECISIONS}
         GROUP BY agent_id, agent_version`,
      )
      .all(projectId, projectId, since ?? '') as unknown as AgentDecisionRow[];
  }

  pipelines(projectId: string | null, since: string | null): PipelineRow[] {
    return this.db
      .prepare(
        `SELECT pipeline_id AS pipelineId, pipeline_version AS pipelineVersion, COUNT(*) AS runs, SUM(${FINISHED}) AS finished,
           SUM(merged) AS merged, SUM(merged AND NOT intervened) AS mergedUnattended,
           AVG(CASE WHEN ${FINISHED} THEN attempts END) AS avgAttempts, SUM(cost_usd) AS costUsd,
           AVG(CASE WHEN ${FINISHED} THEN cost_usd END) AS avgCostUsd, AVG(CASE WHEN ${FINISHED} THEN duration_ms END) AS avgDurationMs
         FROM scorecard_runs WHERE ${PIPELINE_RUNS}
         GROUP BY pipeline_id, pipeline_version`,
      )
      .all(projectId, projectId, since ?? '') as unknown as PipelineRow[];
  }

  /** The runs an agent version's steps in the period belong to, with only those steps counted. */
  agentRuns(agentId: string, agentVersion: string, projectId: string | null, since: string | null): { total: number; runs: RunRow[] } {
    const where = `${AGENT_STEPS} AND agent_id = ? AND agent_version = ?`;
    const params = [projectId, projectId, since ?? '', agentId, agentVersion];
    const total = this.db.prepare(`SELECT COUNT(DISTINCT run_id) AS n FROM scorecard_steps WHERE ${where}`).get(...params) as { n: number };
    const runs = this.db
      .prepare(
        `WITH steps AS (
           SELECT run_id, COUNT(*) AS attempts, SUM(rework) AS rework, AVG(review_score) AS reviewScore, SUM(cost_usd) AS costUsd,
             SUM(duration_ms) AS durationMs, MIN(started_at) AS startedAt
           FROM scorecard_steps WHERE ${where} GROUP BY run_id),
         picked AS (
           SELECT steps.run_id AS runId, sr.project_id AS projectId, sr.status, steps.startedAt, steps.attempts, steps.rework, steps.reviewScore,
             steps.costUsd, steps.durationMs, sr.merged
           FROM steps JOIN scorecard_runs sr ON sr.run_id = steps.run_id)
         SELECT ${RUN_COLUMNS} FROM picked ${RUN_DETAILS}
         ORDER BY picked.startedAt DESC LIMIT ${RUNS_LIMIT}`,
      )
      .all(...params) as unknown as RunRow[];
    return { total: total.n, runs };
  }

  /** The runs of a pipeline version started in the period. */
  pipelineRuns(pipelineId: string, pipelineVersion: string, projectId: string | null, since: string | null): { total: number; runs: RunRow[] } {
    const where = `${PIPELINE_RUNS} AND pipeline_id = ? AND pipeline_version = ?`;
    const params = [projectId, projectId, since ?? '', pipelineId, pipelineVersion];
    const total = this.db.prepare(`SELECT COUNT(*) AS n FROM scorecard_runs WHERE ${where}`).get(...params) as { n: number };
    const runs = this.db
      .prepare(
        `WITH picked AS (
           SELECT run_id AS runId, project_id AS projectId, status, started_at AS startedAt, attempts, 0 AS rework, NULL AS reviewScore,
             cost_usd AS costUsd, duration_ms AS durationMs, merged
           FROM scorecard_runs WHERE ${where})
         SELECT ${RUN_COLUMNS} FROM picked ${RUN_DETAILS}
         ORDER BY picked.startedAt DESC LIMIT ${RUNS_LIMIT}`,
      )
      .all(...params) as unknown as RunRow[];
    return { total: total.n, runs };
  }

  /** Runs or agent decisions in the log but not in the scorecard: it came after them (migration 10). */
  needsBackfill(): boolean {
    const row = this.db
      .prepare(
        `SELECT (EXISTS (SELECT 1 FROM runs) AND NOT EXISTS (SELECT 1 FROM scorecard_runs))
           OR (EXISTS (SELECT 1 FROM decisions WHERE json_extract(actor, '$.kind') = 'agent') AND NOT EXISTS (SELECT 1 FROM scorecard_decisions)) AS missing`,
      )
      .get() as { missing: number };
    return row.missing === 1;
  }
}
