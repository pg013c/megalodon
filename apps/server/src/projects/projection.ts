import {
  activeProjectSetSchema,
  projectConnectedSchema,
  projectDisconnectedSchema,
  projectEvents,
  projectSettingsChangedSchema,
  type Project,
  type ProjectSettings,
  type StoredEvent,
} from '@megalodon/contracts';
import type { Database } from '../db';
import type { Projection } from '../events/projection';

/** Connected projects and the active project (tables from migration 2). */
export class ProjectsProjection implements Projection {
  readonly name = 'projects';

  reset(db: Database): void {
    db.exec('DELETE FROM projects; DELETE FROM workspace;');
  }

  apply(db: Database, event: StoredEvent): void {
    switch (event.type) {
      case projectEvents.connected: {
        const p = projectConnectedSchema.parse(event.data);
        db.prepare('INSERT INTO projects (id, name, path, settings, connected_at) VALUES (?, ?, ?, ?, ?)').run(
          p.id,
          p.name,
          p.path,
          JSON.stringify(p.settings),
          event.at,
        );
        return;
      }
      case projectEvents.settingsChanged: {
        const { id, settings } = projectSettingsChangedSchema.parse(event.data);
        db.prepare('UPDATE projects SET settings = ? WHERE id = ?').run(JSON.stringify(settings), id);
        return;
      }
      case projectEvents.disconnected: {
        const { id } = projectDisconnectedSchema.parse(event.data);
        db.prepare('DELETE FROM projects WHERE id = ?').run(id);
        db.prepare('UPDATE workspace SET active_project_id = NULL WHERE active_project_id = ?').run(id);
        return;
      }
      case projectEvents.activeSet: {
        const { projectId } = activeProjectSetSchema.parse(event.data);
        db.prepare(
          `INSERT INTO workspace (id, active_project_id) VALUES (1, ?)
           ON CONFLICT (id) DO UPDATE SET active_project_id = excluded.active_project_id`,
        ).run(projectId);
        return;
      }
    }
  }
}

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  settings: string;
  connected_at: string;
}

export class ProjectsQueries {
  constructor(private readonly db: Database) {}

  list(): Project[] {
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE, connected_at').all();
    return (rows as unknown as ProjectRow[]).map(toProject);
  }

  get(id: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    return row ? toProject(row as unknown as ProjectRow) : null;
  }

  byPath(path: string): Project | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path);
    return row ? toProject(row as unknown as ProjectRow) : null;
  }

  activeProjectId(): string | null {
    const row = this.db.prepare('SELECT active_project_id FROM workspace WHERE id = 1').get() as
      | { active_project_id: string | null }
      | undefined;
    return row?.active_project_id ?? null;
  }
}

function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    settings: JSON.parse(row.settings) as ProjectSettings,
    connectedAt: row.connected_at,
  };
}
