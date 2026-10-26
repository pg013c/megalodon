import type { StoredEvent } from '@megalodon/contracts';
import type { Database } from '../db';

/**
 * A read model derived from the event log (ADR-0003). Its tables come from migrations;
 * `apply` runs inside the transaction that appends the event.
 */
export interface Projection {
  readonly name: string;
  /** Deletes everything this projection derived, before a rebuild replays the log. */
  reset(db: Database): void;
  apply(db: Database, event: StoredEvent): void;
}
