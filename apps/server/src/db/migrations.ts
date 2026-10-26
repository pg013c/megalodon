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
];
