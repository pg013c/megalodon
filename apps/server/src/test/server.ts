import { join } from 'node:path';
import { openDatabase } from '../db';
import { EventStore } from '../events/store';
import { createApp } from '../http/app';
import { ProjectsProjection, ProjectsQueries } from '../projects/projection';
import { ProjectService } from '../projects/service';

export const PORT = 4600;
export const url = (path: string) => `http://127.0.0.1:${PORT}${path}`;

/** The real store, projections, services and app over a database in `dir`. */
export function createTestServer(dir: string) {
  const db = openDatabase(join(dir, 'test.db'));
  const store = new EventStore(db, [new ProjectsProjection()]);
  const projects = new ProjectService(store, new ProjectsQueries(db));
  const app = createApp({ store, projects, version: '0.0.0-test', port: PORT, webDist: null, keepAliveMs: 50 });
  return { db, store, projects, app };
}
