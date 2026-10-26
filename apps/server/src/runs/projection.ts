import {
  plannedStepSchema,
  runCompletedSchema,
  runEvents,
  runStartedSchema,
  stepCompletedSchema,
  stepSessionSchema,
  stepStartedSchema,
  type PlannedStep,
  type Run,
  type RunStep,
  type StoredEvent,
} from '@megalodon/contracts';
import type { Database } from '../db';
import type { Projection } from '../events/projection';

/** Runs and every attempt of their steps. Transcripts stay in the log (`run:<id>`). */
export class RunsProjection implements Projection {
  readonly name = 'runs';

  reset(db: Database): void {
    db.exec('DELETE FROM run_steps; DELETE FROM runs;');
  }

  apply(db: Database, event: StoredEvent): void {
    switch (event.type) {
      case runEvents.started: {
        const r = runStartedSchema.parse(event.data);
        db.prepare(
          `INSERT INTO runs (id, task_id, project_id, pipeline_id, pipeline_version, status, branch, worktree_path, base_ref,
             base_sha, plan, started_at, created_seq)
           VALUES (?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`,
        ).run(r.runId, r.taskId, r.projectId, r.pipelineId, r.pipelineVersion, r.branch, r.worktreePath, r.baseRef, r.baseSha, JSON.stringify(r.plan), event.at, event.seq);
        return;
      }
      case runEvents.stepStarted: {
        const s = stepStartedSchema.parse(event.data);
        // an attempt restarted after a restart starts over
        db.prepare(
          `INSERT OR REPLACE INTO run_steps (run_id, step_id, attempt, idx, kind, name, agent_id, agent_version, status,
             started_at, started_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?)`,
        ).run(s.runId, s.stepId, s.attempt, s.index, s.kind, s.name, s.agentId, s.agentVersion, event.at, event.seq);
        return;
      }
      case runEvents.stepSession: {
        const s = stepSessionSchema.parse(event.data);
        db.prepare('UPDATE run_steps SET session_id = ? WHERE run_id = ? AND step_id = ? AND attempt = ?').run(s.sessionId, s.runId, s.stepId, s.attempt);
        return;
      }
      case runEvents.stepCompleted: {
        const s = stepCompletedSchema.parse(event.data);
        const u = s.usage;
        db.prepare(
          `UPDATE run_steps SET status = ?, ended_at = ?, duration_ms = ?, num_turns = ?, result = ?, error = ?,
             cost_usd = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?
           WHERE run_id = ? AND step_id = ? AND attempt = ?`,
        ).run(s.status, event.at, s.durationMs, s.numTurns, s.result, s.error, u.costUsd, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens, s.runId, s.stepId, s.attempt);
        db.prepare(
          `UPDATE runs SET cost_usd = cost_usd + ?, input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
             cache_read_tokens = cache_read_tokens + ?, cache_write_tokens = cache_write_tokens + ?
           WHERE id = ?`,
        ).run(u.costUsd, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens, s.runId);
        return;
      }
      case runEvents.completed: {
        const r = runCompletedSchema.parse(event.data);
        db.prepare('UPDATE runs SET status = ?, commit_sha = ?, error = ?, ended_at = ? WHERE id = ?').run(r.status, r.commitSha, r.error, event.at, r.runId);
        return;
      }
    }
  }
}

interface RunRow {
  id: string;
  task_id: string;
  project_id: string;
  pipeline_id: string;
  pipeline_version: string;
  status: Run['status'];
  branch: string;
  worktree_path: string;
  base_ref: string;
  base_sha: string;
  plan: string;
  commit_sha: string | null;
  error: string | null;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  started_at: string;
  ended_at: string | null;
}

interface StepRow {
  run_id: string;
  step_id: string;
  attempt: number;
  idx: number;
  kind: RunStep['kind'];
  name: string;
  agent_id: string | null;
  agent_version: string | null;
  status: RunStep['status'];
  session_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  num_turns: number | null;
  result: string | null;
  error: string | null;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export class RunsQueries {
  constructor(private readonly db: Database) {}

  run(id: string): Run | null {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id);
    return row ? toRun(row as unknown as RunRow) : null;
  }

  plan(id: string): PlannedStep[] {
    const row = this.db.prepare('SELECT plan FROM runs WHERE id = ?').get(id) as { plan: string } | undefined;
    return row ? plannedStepSchema.array().parse(JSON.parse(row.plan)) : [];
  }

  /** Newest first. */
  forTask(taskId: string): Run[] {
    const rows = this.db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY created_seq DESC').all(taskId);
    return (rows as unknown as RunRow[]).map(toRun);
  }

  running(): Run[] {
    const rows = this.db.prepare("SELECT * FROM runs WHERE status = 'running' ORDER BY created_seq").all();
    return (rows as unknown as RunRow[]).map(toRun);
  }

  /** Every attempt of every step, in the order they started. */
  steps(runId: string): RunStep[] {
    const rows = this.db.prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY started_seq').all(runId);
    return (rows as unknown as StepRow[]).map(toStep);
  }
}

const usageOf = (row: Pick<RunRow, 'cost_usd' | 'input_tokens' | 'output_tokens' | 'cache_read_tokens' | 'cache_write_tokens'>) => ({
  costUsd: row.cost_usd,
  inputTokens: row.input_tokens,
  outputTokens: row.output_tokens,
  cacheReadTokens: row.cache_read_tokens,
  cacheWriteTokens: row.cache_write_tokens,
});

const durationOf = (startedAt: string, endedAt: string | null) =>
  endedAt === null ? null : new Date(endedAt).getTime() - new Date(startedAt).getTime();

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    taskId: row.task_id,
    projectId: row.project_id,
    pipelineId: row.pipeline_id,
    pipelineVersion: row.pipeline_version,
    status: row.status,
    branch: row.branch,
    worktreePath: row.worktree_path,
    baseRef: row.base_ref,
    baseSha: row.base_sha,
    commitSha: row.commit_sha,
    error: row.error,
    usage: usageOf(row),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: durationOf(row.started_at, row.ended_at),
  };
}

function toStep(row: StepRow): RunStep {
  return {
    runId: row.run_id,
    stepId: row.step_id,
    attempt: row.attempt,
    index: row.idx,
    kind: row.kind,
    name: row.name,
    agentId: row.agent_id,
    agentVersion: row.agent_version,
    status: row.status,
    sessionId: row.session_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMs: row.duration_ms,
    numTurns: row.num_turns,
    usage: usageOf(row),
    result: row.result,
    error: row.error,
  };
}
