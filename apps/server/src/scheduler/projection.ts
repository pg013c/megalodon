import {
  DEFAULT_SLOTS,
  schedulerEvents,
  schedulerPausedSchema,
  slotsSetSchema,
  type SchedulerState,
  type StoredEvent,
} from '@megalodon/contracts';
import type { Database } from '../db';
import type { Projection } from '../events/projection';

/** The queue's settings and pause (table from migration 6). */
export class SchedulerProjection implements Projection {
  readonly name = 'scheduler';

  reset(db: Database): void {
    db.exec('DELETE FROM scheduler');
  }

  apply(db: Database, event: StoredEvent): void {
    const upsert = (slots: number | null, paused: string | null, until: string | null, keepSlots: boolean) =>
      db
        .prepare(
          `INSERT INTO scheduler (id, slots, paused, paused_until) VALUES (1, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET
             slots = CASE WHEN ? THEN slots ELSE excluded.slots END,
             paused = CASE WHEN ? THEN excluded.paused ELSE paused END,
             paused_until = CASE WHEN ? THEN excluded.paused_until ELSE paused_until END`,
        )
        .run(slots ?? DEFAULT_SLOTS, paused, until, keepSlots ? 1 : 0, keepSlots ? 1 : 0, keepSlots ? 1 : 0);
    switch (event.type) {
      case schedulerEvents.slotsSet:
        upsert(slotsSetSchema.parse(event.data).slots, null, null, false);
        return;
      case schedulerEvents.paused: {
        const p = schedulerPausedSchema.parse(event.data);
        upsert(null, p.reason, p.until, true);
        return;
      }
      case schedulerEvents.resumed:
        upsert(null, null, null, true);
        return;
    }
  }
}

export class SchedulerQueries {
  constructor(private readonly db: Database) {}

  state(): SchedulerState {
    const row = this.db.prepare('SELECT slots, paused, paused_until FROM scheduler WHERE id = 1').get() as
      | { slots: number; paused: SchedulerState['paused']; paused_until: string | null }
      | undefined;
    return { slots: row?.slots ?? DEFAULT_SLOTS, paused: row?.paused ?? null, pausedUntil: row?.paused_until ?? null };
  }
}
