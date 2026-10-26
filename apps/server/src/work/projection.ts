import {
  canTransition,
  dependencyAddedSchema,
  dependencyMetSchema,
  dependencyRemovedSchema,
  deriveStoryStatus,
  initialStatus,
  storyCreatedSchema,
  storyUpdatedSchema,
  taskCreatedSchema,
  taskMovedToFrontSchema,
  taskPipelineSetSchema,
  taskStatusChangedSchema,
  taskTouchesSetSchema,
  taskUpdatedSchema,
  triageEventSchema,
  workEvents,
  type Dependency,
  type StoredEvent,
  type Story,
  type Task,
  type TaskKind,
} from '@megalodon/contracts';
import type { Database } from '../db';
import type { Projection } from '../events/projection';

/** Stories, tasks with their status, touch-set and triage state, and dependencies. */
export class WorkProjection implements Projection {
  readonly name = 'work';

  reset(db: Database): void {
    db.exec('DELETE FROM dependencies; DELETE FROM tasks; DELETE FROM stories;');
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
        // leaving the queue forgets "move to front"
        db.prepare(
          `UPDATE tasks SET status = ?, status_reason = ?, status_changed_at = ?,
             front_seq = CASE WHEN ? IN ('ready', 'blocked') THEN front_seq ELSE NULL END
           WHERE id = ?`,
        ).run(change.to, change.reason, event.at, change.to, change.id);
        return;
      }
      case workEvents.taskTouchesSet: {
        const t = taskTouchesSetSchema.parse(event.data);
        db.prepare('UPDATE tasks SET touches = ? WHERE id = ?').run(JSON.stringify(t.touches), t.id);
        return;
      }
      case workEvents.taskPipelineSet: {
        const t = taskPipelineSetSchema.parse(event.data);
        db.prepare('UPDATE tasks SET pipeline_id = ? WHERE id = ?').run(t.pipelineId, t.id);
        return;
      }
      case workEvents.taskMovedToFront: {
        const t = taskMovedToFrontSchema.parse(event.data);
        db.prepare('UPDATE tasks SET front_seq = ? WHERE id = ?').run(event.seq, t.id);
        return;
      }
      case workEvents.triageRequested:
      case workEvents.triageStarted:
      case workEvents.triageCompleted:
      case workEvents.triageFailed: {
        const t = triageEventSchema.parse(event.data);
        const state = { [workEvents.triageRequested]: 'pending', [workEvents.triageStarted]: 'running', [workEvents.triageCompleted]: 'done', [workEvents.triageFailed]: 'failed' }[event.type];
        db.prepare('UPDATE tasks SET triage = ?, triage_summary = COALESCE(?, triage_summary) WHERE id = ?').run(state ?? 'none', t.summary ?? null, t.taskId);
        return;
      }
      case workEvents.dependencyAdded: {
        const d = dependencyAddedSchema.parse(event.data);
        db.prepare(
          `INSERT INTO dependencies (id, task_id, kind, target_type, target_id, description, command, met, created_at, seq)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        ).run(d.id, d.taskId, d.kind, d.target?.type ?? null, d.target?.id ?? null, d.description, d.command, event.at, event.seq);
        return;
      }
      case workEvents.dependencyRemoved: {
        db.prepare('DELETE FROM dependencies WHERE id = ?').run(dependencyRemovedSchema.parse(event.data).id);
        return;
      }
      case workEvents.dependencyMet: {
        db.prepare('UPDATE dependencies SET met = 1 WHERE id = ?').run(dependencyMetSchema.parse(event.data).id);
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
  touches: string;
  pipeline_id: string;
  front_seq: number | null;
  triage: Task['triage'];
  triage_summary: string | null;
}

interface DependencyRow {
  id: string;
  task_id: string;
  kind: Dependency['kind'];
  target_type: 'task' | 'story' | null;
  target_id: string | null;
  description: string;
  command: string | null;
  met: number;
  created_at: string;
}

export class WorkQueries {
  constructor(private readonly db: Database) {}

  /** Tasks in creation order, which is also queue order (CONCEPTS.md §5). */
  tasks(projectId: string): Task[] {
    const rows = this.db.prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_seq').all(projectId);
    return (rows as unknown as TaskRow[]).map(toTask);
  }

  /** Tasks in these statuses across all projects, in queue order: moved to front first, then oldest. */
  inStatus(statuses: readonly string[]): Task[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM tasks WHERE status IN (${statuses.map(() => '?').join(', ')})
         ORDER BY front_seq IS NULL, front_seq DESC, created_seq`,
      )
      .all(...statuses);
    return (rows as unknown as TaskRow[]).map(toTask);
  }

  /** Tasks whose triage is pending or was interrupted. */
  awaitingTriage(): Task[] {
    const rows = this.db.prepare("SELECT * FROM tasks WHERE triage IN ('pending', 'running') ORDER BY created_seq").all();
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

  byNumber(projectId: string, number: number): { type: 'task' | 'story'; id: string } | null {
    const task = this.db.prepare('SELECT id FROM tasks WHERE project_id = ? AND number = ?').get(projectId, number) as { id: string } | undefined;
    if (task) return { type: 'task', id: task.id };
    const story = this.db.prepare('SELECT id FROM stories WHERE project_id = ? AND number = ?').get(projectId, number) as { id: string } | undefined;
    return story ? { type: 'story', id: story.id } : null;
  }

  story(id: string): Story | null {
    const row = this.db.prepare('SELECT * FROM stories WHERE id = ?').get(id);
    if (!row) return null;
    return toStory(row as unknown as StoryRow, this.storyTasks(id));
  }

  storyTasks(storyId: string): Task[] {
    return (this.db.prepare('SELECT * FROM tasks WHERE story_id = ? ORDER BY created_seq').all(storyId) as unknown as TaskRow[]).map(toTask);
  }

  dependencies(taskId: string): Dependency[] {
    const rows = this.db.prepare('SELECT * FROM dependencies WHERE task_id = ? ORDER BY seq').all(taskId);
    return (rows as unknown as DependencyRow[]).map(toDependency);
  }

  dependency(id: string): Dependency | null {
    const row = this.db.prepare('SELECT * FROM dependencies WHERE id = ?').get(id);
    return row ? toDependency(row as unknown as DependencyRow) : null;
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
    touches: JSON.parse(row.touches) as string[],
    pipelineId: row.pipeline_id,
    front: row.front_seq !== null,
    triage: row.triage,
    triageSummary: row.triage_summary,
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

function toDependency(row: DependencyRow): Dependency {
  return {
    id: row.id,
    taskId: row.task_id,
    kind: row.kind,
    target: row.target_type && row.target_id ? { type: row.target_type, id: row.target_id } : null,
    description: row.description,
    command: row.command,
    met: row.met === 1,
    createdAt: row.created_at,
  };
}
