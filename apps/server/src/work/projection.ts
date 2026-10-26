import {
  canTransition,
  deriveStoryStatus,
  initialStatus,
  storyCreatedSchema,
  storyUpdatedSchema,
  taskCreatedSchema,
  taskStatusChangedSchema,
  taskUpdatedSchema,
  workEvents,
  type StoredEvent,
  type Story,
  type Task,
  type TaskKind,
} from '@megalodon/contracts';
import type { Database } from '../db';
import type { Projection } from '../events/projection';

/** Stories and tasks with their current status (tables from migration 3). */
export class WorkProjection implements Projection {
  readonly name = 'work';

  reset(db: Database): void {
    db.exec('DELETE FROM tasks; DELETE FROM stories;');
  }

  apply(db: Database, event: StoredEvent): void {
    switch (event.type) {
      case workEvents.storyCreated: {
        const s = storyCreatedSchema.parse(event.data);
        db.prepare(
          'INSERT INTO stories (id, project_id, number, title, description, created_at, created_seq) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(s.id, s.projectId, s.number, s.title, s.description, event.at, event.seq);
        return;
      }
      case workEvents.storyUpdated: {
        const s = storyUpdatedSchema.parse(event.data);
        db.prepare('UPDATE stories SET title = COALESCE(?, title), description = COALESCE(?, description) WHERE id = ?').run(
          s.title ?? null,
          s.description ?? null,
          s.id,
        );
        return;
      }
      case workEvents.taskCreated: {
        const t = taskCreatedSchema.parse(event.data);
        db.prepare(
          `INSERT INTO tasks (id, project_id, number, kind, story_id, title, description, status, status_reason,
             status_changed_at, created_at, created_seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        ).run(t.id, t.projectId, t.number, t.kind, t.storyId, t.title, t.description, initialStatus(t.kind), event.at, event.at, event.seq);
        return;
      }
      case workEvents.taskUpdated: {
        const t = taskUpdatedSchema.parse(event.data);
        db.prepare(
          `UPDATE tasks SET title = COALESCE(?, title), description = COALESCE(?, description),
             story_id = CASE WHEN ? THEN ? ELSE story_id END
           WHERE id = ?`,
        ).run(t.title ?? null, t.description ?? null, t.storyId !== undefined ? 1 : 0, t.storyId ?? null, t.id);
        return;
      }
      case workEvents.taskStatusChanged: {
        const change = taskStatusChangedSchema.parse(event.data);
        const row = db.prepare('SELECT kind, status FROM tasks WHERE id = ?').get(change.id) as
          | { kind: TaskKind; status: string }
          | undefined;
        // The log may never hold a transition the state machine forbids (CONCEPTS.md §3).
        if (!row || row.status !== change.from || !canTransition(row.kind, change.from, change.to)) {
          throw new Error(`Invalid transition of task ${change.id}: ${row?.status ?? 'missing'} → ${change.to} (event says ${change.from})`);
        }
        db.prepare('UPDATE tasks SET status = ?, status_reason = ?, status_changed_at = ? WHERE id = ?').run(
          change.to,
          change.reason,
          event.at,
          change.id,
        );
        return;
      }
    }
  }
}

interface StoryRow {
  id: string;
  project_id: string;
  number: number;
  title: string;
  description: string;
  created_at: string;
}

interface TaskRow {
  id: string;
  project_id: string;
  number: number;
  kind: TaskKind;
  story_id: string | null;
  title: string;
  description: string;
  status: string;
  status_reason: string | null;
  status_changed_at: string;
  created_at: string;
}

export class WorkQueries {
  constructor(private readonly db: Database) {}

  /** Tasks in creation order, which is also queue order (CONCEPTS.md §5). */
  tasks(projectId: string): Task[] {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_seq').all(projectId);
    return (rows as unknown as TaskRow[]).map(toTask);
  }

  stories(projectId: string): Story[] {
    const rows = this.db.prepare('SELECT * FROM stories WHERE project_id = ? ORDER BY created_seq').all(projectId);
    const tasks = this.tasks(projectId);
    return (rows as unknown as StoryRow[]).map((row) => toStory(row, tasks.filter((t) => t.storyId === row.id)));
  }

  task(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return row ? toTask(row as unknown as TaskRow) : null;
  }

  story(id: string): Story | null {
    const row = this.db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
    if (!row) return null;
    const tasks = (this.db.prepare('SELECT * FROM tasks WHERE story_id = ?').all(id) as unknown as TaskRow[]).map(toTask);
    return toStory(row as unknown as StoryRow, tasks);
  }

  /** The next number for a new story or task in the project. */
  nextNumber(projectId: string): number {
    const row = this.db
      .prepare(
        `SELECT MAX(n) AS n FROM (
           SELECT MAX(number) AS n FROM stories WHERE project_id = ?
           UNION ALL SELECT MAX(number) FROM tasks WHERE project_id = ?)`,
      )
      .get(projectId, projectId) as { n: number | null };
    return (row.n ?? 0) + 1;
  }
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    kind: row.kind,
    storyId: row.story_id,
    title: row.title,
    description: row.description,
    status: row.status as Task['status'],
    statusReason: row.status_reason,
    statusChangedAt: row.status_changed_at,
    createdAt: row.created_at,
  };
}

function toStory(row: StoryRow, tasks: readonly Task[]): Story {
  return {
    id: row.id,
    projectId: row.project_id,
    number: row.number,
    title: row.title,
    description: row.description,
    status: deriveStoryStatus(tasks),
    taskCount: tasks.length,
    doneCount: tasks.filter((t) => t.status === 'done' || t.status === 'verified').length,
    createdAt: row.created_at,
  };
}
