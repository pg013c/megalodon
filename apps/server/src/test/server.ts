import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../db';
import { EventStore } from '../events/store';
import { createApp } from '../http/app';
import { ProjectsProjection, ProjectsQueries } from '../projects/projection';
import { ProjectService } from '../projects/service';
import { AgentLibrary } from '../library/agents';
import { RunsProjection, RunsQueries } from '../runs/projection';
import { RunService } from '../runs/service';
import type { AgentRuntime } from '../runtime/types';
import { WorkProjection, WorkQueries } from '../work/projection';
import { ScriptedRuntime } from './scriptedRuntime';
import { WorkService } from '../work/service';

export const PORT = 4600;
export const url = (path: string) => `http://127.0.0.1:${PORT}${path}`;

const builtinLibrary = fileURLToPath(new URL('../../../../library', import.meta.url));

/** The real store, projections, services and app over a database in `dir`; agents are scripted. */
export function createTestServer(dir: string, runtime: AgentRuntime = new ScriptedRuntime()) {
  const db = openDatabase(join(dir, 'test.db'));
  const store = new EventStore(db, [new ProjectsProjection(), new WorkProjection(), new RunsProjection()]);
  const projectsQueries = new ProjectsQueries(db);
  const projects = new ProjectService(store, projectsQueries);
  const work = new WorkService(store, new WorkQueries(db), projectsQueries);
  const library = new AgentLibrary([{ source: 'builtin', path: builtinLibrary }]);
  const runs = new RunService({
    store,
    runs: new RunsQueries(db),
    work,
    projects: projectsQueries,
    library,
    runtime,
    dataDir: dir,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
  });
  const app = createApp({ store, projects, work, runs, library, version: '0.0.0-test', port: PORT, webDist: null, keepAliveMs: 50 });
  return { db, store, projects, work, runs, library, app };
}
