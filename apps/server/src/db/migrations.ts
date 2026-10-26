export interface Migration {
  id: number;
  name: string;
  sql: string;
}

/** Applied in order at startup; never edit a migration once it is committed, add a new one. */
export const migrations: readonly Migration[] = [
  {
    id: 1,
    name: 'event log',
    sql: `
      CREATE TABLE events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        stream TEXT NOT NULL,
        data TEXT NOT NULL,
        actor TEXT NOT NULL,
        at TEXT NOT NULL
      );
      CREATE INDEX events_by_stream ON events (stream, seq);
      CREATE TRIGGER events_no_update BEFORE UPDATE ON events
        BEGIN SELECT RAISE(ABORT, 'events are immutable'); END;
      CREATE TRIGGER events_no_delete BEFORE DELETE ON events
        BEGIN SELECT RAISE(ABORT, 'events are immutable'); END;
    `,
  },
  {
    id: 2,
    name: 'projects and workspace',
    sql: `
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        settings TEXT NOT NULL,
        connected_at TEXT NOT NULL
      );
      CREATE TABLE workspace (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        active_project_id TEXT
      );
    `,
  },
  {
    id: 3,
    name: 'stories and tasks',
    sql: `
      CREATE TABLE stories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_seq INTEGER NOT NULL
      );
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        number INTEGER NOT NULL,
        kind TEXT NOT NULL,
        story_id TEXT REFERENCES stories (id),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL,
        status_reason TEXT,
        status_changed_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_seq INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX stories_by_number ON stories (project_id, number);
      CREATE UNIQUE INDEX tasks_by_number ON tasks (project_id, number);
      CREATE INDEX tasks_by_story ON tasks (story_id);
    `,
  },
  {
    id: 4,
    name: 'runs and steps',
    sql: `
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        branch TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        base_ref TEXT NOT NULL,
        base_sha TEXT NOT NULL,
        plan TEXT NOT NULL,
        commit_sha TEXT,
        error TEXT,
        cost_usd REAL NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        created_seq INTEGER NOT NULL
      );
      CREATE INDEX runs_by_task ON runs (task_id, created_seq);
      CREATE TABLE run_steps (
        run_id TEXT NOT NULL REFERENCES runs (id),
        step_id TEXT NOT NULL,
        idx INTEGER NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        agent_id TEXT,
        agent_version TEXT,
        status TEXT NOT NULL,
        session_id TEXT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        duration_ms INTEGER,
        num_turns INTEGER,
        result TEXT,
        error TEXT,
        cost_usd REAL NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, step_id)
      );
    `,
  },
  {
    id: 5,
    name: 'pipelines, step attempts and decisions',
    sql: `
      ALTER TABLE runs ADD COLUMN pipeline_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE runs ADD COLUMN pipeline_version TEXT NOT NULL DEFAULT '';
      UPDATE runs SET pipeline_id = 'agent:' || agent_id, pipeline_version = 'unknown';
      ALTER TABLE runs DROP COLUMN agent_id;
      CREATE TABLE run_steps_v5 (
        run_id TEXT NOT NULL REFERENCES runs (id),
        step_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        idx INTEGER NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        agent_id TEXT,
        agent_version TEXT,
        status TEXT NOT NULL,
        session_id TEXT,
        started_at TEXT NOT NULL,
        started_seq INTEGER NOT NULL,
        ended_at TEXT,
        duration_ms INTEGER,
        num_turns INTEGER,
        result TEXT,
        error TEXT,
        cost_usd REAL NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (run_id, step_id, attempt)
      );
      INSERT INTO run_steps_v5
        SELECT run_id, step_id, 1, idx, kind, name, agent_id, agent_version, status, session_id, started_at, idx,
          ended_at, duration_ms, num_turns, result, error, cost_usd, input_tokens, output_tokens, cache_read_tokens,
          cache_write_tokens
        FROM run_steps;
      DROP TABLE run_steps;
      ALTER TABLE run_steps_v5 RENAME TO run_steps;
      CREATE TABLE decisions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        run_id TEXT,
        step_id TEXT,
        kind TEXT NOT NULL,
        outcome TEXT NOT NULL,
        rationale TEXT NOT NULL,
        alternatives TEXT NOT NULL,
        inputs TEXT NOT NULL,
        actor TEXT NOT NULL,
        at TEXT NOT NULL,
        seq INTEGER NOT NULL,
        superseded_by TEXT,
        overrides TEXT
      );
      CREATE INDEX decisions_by_task ON decisions (task_id, seq);
      CREATE INDEX decisions_by_run ON decisions (run_id, seq);
    `,
  },
  {
    id: 6,
    name: 'triage, dependencies and the scheduler',
    sql: `
      ALTER TABLE tasks ADD COLUMN touches TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE tasks ADD COLUMN pipeline_id TEXT NOT NULL DEFAULT 'feature';
      ALTER TABLE tasks ADD COLUMN front_seq INTEGER;
      ALTER TABLE tasks ADD COLUMN triage TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE tasks ADD COLUMN triage_summary TEXT;
      CREATE TABLE dependencies (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        description TEXT NOT NULL,
        command TEXT,
        met INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        seq INTEGER NOT NULL
      );
      CREATE INDEX dependencies_by_task ON dependencies (task_id, seq);
      CREATE INDEX dependencies_by_target ON dependencies (target_id);
      CREATE TABLE scheduler (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        slots INTEGER NOT NULL,
        paused TEXT,
        paused_until TEXT
      );
    `,
  },
];
