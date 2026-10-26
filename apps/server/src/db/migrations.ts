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
];
