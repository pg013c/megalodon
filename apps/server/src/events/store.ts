import { randomUUID } from 'node:crypto';
import { newEventSchema, type NewEvent, type StoredEvent } from '@megalodon/contracts';
import { transaction, type Database } from '../db';
import type { Projection } from './projection';

type Listener = (event: StoredEvent) => void;

interface EventRow {
  seq: number;
  id: string;
  type: string;
  stream: string;
  data: string;
  actor: string;
  at: string;
}

/** The append-only event log and the only writer of projections (ADR-0003). */
export class EventStore {
  private readonly listeners = new Set<Listener>();
  private readonly insert;

  constructor(
    private readonly db: Database,
    private readonly projections: readonly Projection[],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.insert = db.prepare(
      'INSERT INTO events (id, type, stream, data, actor, at) VALUES (?, ?, ?, ?, ?, ?)',
    );
  }

  /** Appends events and updates every projection in one transaction; listeners hear after commit. */
  append(events: readonly NewEvent[]): StoredEvent[] {
    const stored = transaction(this.db, () =>
      events.map((input) => {
        const event = newEventSchema.parse(input);
        const id = randomUUID();
        const at = this.now().toISOString();
        const { lastInsertRowid } = this.insert.run(
          id,
          event.type,
          event.stream,
          JSON.stringify(event.data ?? null),
          JSON.stringify(event.actor),
          at,
        );
        const record: StoredEvent = { ...event, data: event.data ?? null, seq: Number(lastInsertRowid), id, at };
        for (const projection of this.projections) projection.apply(this.db, record);
        return record;
      }),
    );
    for (const event of stored) for (const listener of this.listeners) listener(event);
    return stored;
  }

  /** Events with `seq` greater than `afterSeq`, in log order. */
  read(afterSeq = 0, limit = 1000): StoredEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM events WHERE seq > ? ORDER BY seq LIMIT ?')
      .all(afterSeq, limit) as unknown as EventRow[];
    return rows.map(toEvent);
  }

  /** Every event of one stream, in log order. */
  readStream(stream: string): StoredEvent[] {
    const rows = this.db.prepare('SELECT * FROM events WHERE stream = ? ORDER BY seq').all(stream) as unknown as EventRow[];
    return rows.map(toEvent);
  }

  lastSeq(): number {
    const row = this.db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM events').get() as { seq: number };
    return row.seq;
  }

  /** Recomputes every projection from the whole log in one transaction. */
  rebuild(): void {
    transaction(this.db, () => {
      for (const projection of this.projections) projection.reset(this.db);
      const rows = this.db.prepare('SELECT * FROM events ORDER BY seq').iterate() as Iterable<unknown>;
      for (const row of rows) {
        const event = toEvent(row as EventRow);
        for (const projection of this.projections) projection.apply(this.db, event);
      }
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

function toEvent(row: EventRow): StoredEvent {
  return {
    seq: row.seq,
    id: row.id,
    type: row.type,
    stream: row.stream,
    data: JSON.parse(row.data) as unknown,
    actor: JSON.parse(row.actor) as StoredEvent['actor'],
    at: row.at,
  };
}
