import { mergeBlockedSchema, mergeEvents, mergeUnblockedSchema, type StoredEvent } from '@megalodon/contracts';
import type { Database } from '../db';
import type { Projection } from '../events/projection';

/** Projects whose merges wait for the operator's checkout (table from migration 7). */
export class MergeProjection implements Projection {
  readonly name = 'merge';

  reset(db: Database): void {
    db.exec('DELETE FROM merge_blocks');
  }

  apply(db: Database, event: StoredEvent): void {
    if (event.type === mergeEvents.blocked) {
      const b = mergeBlockedSchema.parse(event.data);
      db.prepare(
        `INSERT INTO merge_blocks (project_id, reason, since) VALUES (?, ?, ?)
         ON CONFLICT (project_id) DO UPDATE SET reason = excluded.reason`,
      ).run(b.projectId, b.reason, event.at);
    } else if (event.type === mergeEvents.unblocked) {
      db.prepare('DELETE FROM merge_blocks WHERE project_id = ?').run(mergeUnblockedSchema.parse(event.data).projectId);
    }
  }
}

export class MergeQueries {
  constructor(private readonly db: Database) {}

  blocks(): { projectId: string; reason: string; since: string }[] {
    return (this.db.prepare('SELECT project_id, reason, since FROM merge_blocks ORDER BY since').all() as { project_id: string; reason: string; since: string }[]).map(
      (r) => ({ projectId: r.project_id, reason: r.reason, since: r.since }),
    );
  }

  block(projectId: string): string | null {
    const row = this.db.prepare('SELECT reason FROM merge_blocks WHERE project_id = ?').get(projectId) as { reason: string } | undefined;
    return row?.reason ?? null;
  }
}
