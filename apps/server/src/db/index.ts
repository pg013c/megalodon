// The only module that touches node:sqlite (ADR-0018).
import { DatabaseSync } from 'node:sqlite';
import { migrations, type Migration } from './migrations';

export type Database = DatabaseSync;

export function openDatabase(path: string, list: readonly Migration[] = migrations): Database {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db, list);
  return db;
}

const active = new WeakSet<Database>();

/** Runs `fn` in one immediate transaction. Transactions do not nest. */
export function transaction<T>(db: Database, fn: () => T): T {
  if (active.has(db)) throw new Error('Nested transactions are not supported');
  active.add(db);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    active.delete(db);
  }
}

function migrate(db: Database, list: readonly Migration[]): void {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied = new Set(
    (db.prepare('SELECT id FROM migrations').all() as { id: number }[]).map((row) => row.id),
  );
  const record = db.prepare('INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, ?)');
  for (const migration of list) {
    if (applied.has(migration.id)) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      record.run(migration.id, migration.name, new Date().toISOString());
    });
  }
}
