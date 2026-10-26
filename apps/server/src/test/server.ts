import { join } from 'node:path';
import { openDatabase } from '../db';
import { EventStore } from '../events/store';
import { createApp } from '../http/app';
import { ProjectsProjection, ProjectsQueries } from '../projects/projection';
import { ProjectService } from '../projects/service';
import { WorkProjection, WorkQueries } from '../work/projection';
import { WorkService } from '../work/service';

export const PORT = 4600;
export const url = (path: string) => `http://127.0.0.1:${PORT}${path}`;

/** The real store, projections, services and app over a database in `dir`. */
export function createTestServer(dir: string) {
  const db = openDatabase(join(dir, 'test.db'));
  const store = new EventStore(db, [new ProjectsProjection(), new WorkProjection()]);
  const projectsQueries = new ProjectsQueries(db);
  const projects = new ProjectService(store, projectsQueries);
  const work = new WorkService(store, new WorkQueries(db), projectsQueries);
  const app = createApp({ store, projects, work, version: '0.0.0-test', port: PORT, webDist: null, keepAliveMs: 50 });
  return { db, store, projects, work, app };
}
