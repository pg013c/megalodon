import {
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

/** Runs and their steps (tables from migration 4). Transcripts stay in the log (`run:<id>`). */
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
          `INSERT INTO runs (id, task_id, project_id, agent_id, status, branch, worktree_path, base_ref, base_sha, plan,
             started_at, created_seq)
           VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`,
        ).run(r.runId, r.taskId, r.projectId, r.agentId, r.branch, r.worktreePath, r.baseRef, r.baseSha, JSON.stringify(r.plan), event.at, event.seq);
        return;
      }
      case runEvents.stepStarted: {
        const s = stepStartedSchema.parse(event.data);
        // a step restarted after a restart starts over
        db.prepare(
          `INSERT OR REPLACE INTO run_steps (run_id, step_id, idx, kind, name, agent_id, agent_version, status, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?)`,
        ).run(s.runId, s.stepId, s.index, s.kind, s.name, s.agentId, s.agentVersion, event.at);
        return;
      }
      case runEvents.stepSession: {
        const s = stepSessionSchema.parse(event.data);
        db.prepare('UPDATE run_steps SET session_id = ? WHERE run_id = ? AND step_id = ?').run(s.sessionId, s.runId, s.stepId);
        return;
      }
      case runEvents.stepCompleted: {
        const s = stepCompletedSchema.parse(event.data);
        const u = s.usage;
        db.prepare(
          `UPDATE run_steps SET status = ?, ended_at = ?, duration_ms = ?, num_turns = ?, result = ?, error = ?,
             cost_usd = ?, input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_write_tokens = ?
           WHERE run_id = ? AND step_id = ?`,
        ).run(s.status, event.at, s.durationMs, s.numTurns, s.result, s.error, u.costUsd, u.inputTokens, u.outputTokens, u.cacheReadTokens, u.cacheWriteTokens, s.runId, s.stepId);
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
  agent_id: string;
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
    return row ? (JSON.parse(row.plan) as PlannedStep[]) : [];
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

  steps(runId: string): RunStep[] {
    const rows = this.db.prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY idx').all(runId);
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
    agentId: row.agent_id,
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
