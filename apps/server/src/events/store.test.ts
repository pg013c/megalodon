import { join } from 'node:path';
import type { NewEvent, StoredEvent } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { openDatabase, type Database } from '../db';
import type { Migration } from '../db/migrations';
import { migrations } from '../db/migrations';
import { useTempDir } from '../test/tempDir';
import type { Projection } from './projection';
import { EventStore } from './store';

// A projection used only by these tests: counts events per stream.
const counterMigration: Migration = {
  id: 1000,
  name: 'test counter',
  sql: 'CREATE TABLE test_counts (stream TEXT PRIMARY KEY, count INTEGER NOT NULL)',
};

class CounterProjection implements Projection {
  readonly name = 'test-counter';
  failOn: string | null = null;

  reset(db: Database): void {
    db.exec('DELETE FROM test_counts');
  }

  apply(db: Database, event: StoredEvent): void {
    if (event.type === this.failOn) throw new Error(`projection failed on ${event.type}`);
    db.prepare(
      `INSERT INTO test_counts (stream, count) VALUES (?, 1)
       ON CONFLICT (stream) DO UPDATE SET count = count + 1`,
    ).run(event.stream);
  }
}

const tempDir = useTempDir();

function setup() {
  const db = openDatabase(join(tempDir(), 'test.db'), [...migrations, counterMigration]);
  const projection = new CounterProjection();
  const store = new EventStore(db, [projection]);
  const counts = () =>
    Object.fromEntries(
      (db.prepare('SELECT stream, count FROM test_counts ORDER BY stream').all() as { stream: string; count: number }[]).map(
        (row) => [row.stream, row.count],
      ),
    );
  return { db, store, projection, counts };
}

const event = (type: string, stream: string, data: unknown = null): NewEvent => ({
  type,
  stream,
  data,
  actor: { kind: 'operator' },
});

describe('EventStore', () => {
  it('appends events in order and updates projections', () => {
    const { store, counts } = setup();
    const stored = store.append([event('a', 'task:1', { x: 1 }), event('b', 'task:1'), event('c', 'task:2')]);

    expect(stored.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(store.read().map((e) => [e.seq, e.type, e.data])).toEqual([
      [1, 'a', { x: 1 }],
      [2, 'b', null],
      [3, 'c', null],
    ]);
    expect(store.lastSeq()).toBe(3);
    expect(counts()).toEqual({ 'task:1': 2, 'task:2': 1 });
  });

  it('rolls back events and projection updates together when a projection fails', () => {
    const { store, projection, counts } = setup();
    store.append([event('a', 'task:1')]);
    projection.failOn = 'boom';

    expect(() => store.append([event('b', 'task:1'), event('boom', 'task:2')])).toThrow('projection failed');
    expect(store.lastSeq()).toBe(1);
    expect(counts()).toEqual({ 'task:1': 1 });
  });

  it('rejects invalid events without writing anything', () => {
    const { store } = setup();
    expect(() => store.append([{ ...event('a', 'task:1'), stream: '' }])).toThrow();
    expect(store.lastSeq()).toBe(0);
  });

  it('rebuilds projections from the log to the same state', () => {
    const { db, store, counts } = setup();
    store.append([event('a', 'task:1'), event('b', 'task:2'), event('c', 'task:1')]);
    const before = counts();
    db.exec("UPDATE test_counts SET count = 99 WHERE stream = 'task:1'");

    store.rebuild();

    expect(counts()).toEqual(before);
  });

  it('notifies subscribers after commit only', () => {
    const { store, projection } = setup();
    const heard: number[] = [];
    const unsubscribe = store.subscribe((e) => heard.push(e.seq));

    store.append([event('a', 'task:1'), event('b', 'task:1')]);
    projection.failOn = 'boom';
    expect(() => store.append([event('boom', 'task:1')])).toThrow();
    unsubscribe();
    projection.failOn = null;
    store.append([event('c', 'task:1')]);

    expect(heard).toEqual([1, 2]);
  });

  it('refuses to update or delete stored events', () => {
    const { db, store } = setup();
    store.append([event('a', 'task:1')]);
    expect(() => db.exec("UPDATE events SET type = 'x'")).toThrow('events are immutable');
    expect(() => db.exec('DELETE FROM events')).toThrow('events are immutable');
  });

  it('reads events after a given sequence number', () => {
    const { store } = setup();
    store.append([event('a', 's'), event('b', 's'), event('c', 's')]);
    expect(store.read(1).map((e) => e.type)).toEqual(['b', 'c']);
    expect(store.read(1, 1).map((e) => e.type)).toEqual(['b']);
  });
});
