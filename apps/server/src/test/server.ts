import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../db';
import { EventStore } from '../events/store';
import { createApp } from '../http/app';
import { ProjectsProjection, ProjectsQueries } from '../projects/projection';
import { ProjectService } from '../projects/service';
import { DecisionsProjection, DecisionsQueries } from '../decisions/projection';
import { DecisionService } from '../decisions/service';
import { Library } from '../library/library';
import { RunsProjection, RunsQueries } from '../runs/projection';
import { RunService } from '../runs/service';
import type { AgentRuntime } from '../runtime/types';
import { SchedulerProjection, SchedulerQueries } from '../scheduler/projection';
import { Scheduler } from '../scheduler/service';
import { TriageService } from '../triage/service';
import { WorkProjection, WorkQueries } from '../work/projection';
import { ScriptedRuntime } from './scriptedRuntime';
import { WorkService } from '../work/service';

export const PORT = 4600;
export const url = (path: string) => `http://127.0.0.1:${PORT}${path}`;

const builtinLibrary = fileURLToPath(new URL('../../../../library', import.meta.url));

/** The real store, projections, services and app over a database in `dir`; agents are scripted. */
export function createTestServer(dir: string, runtime: AgentRuntime = new ScriptedRuntime(), options: { autoTriage?: boolean; now?: () => Date } = {}) {
  const db = openDatabase(join(dir, 'test.db'));
  const store = new EventStore(db, [new ProjectsProjection(), new WorkProjection(), new RunsProjection(), new DecisionsProjection(), new SchedulerProjection()]);
  const projectsQueries = new ProjectsQueries(db);
  const projects = new ProjectService(store, projectsQueries);
  const work = new WorkService(store, new WorkQueries(db), projectsQueries);
  const library = new Library([{ source: 'builtin', path: builtinLibrary }]);
  const decisions = new DecisionService(store, new DecisionsQueries(db));
  const runsQueries = new RunsQueries(db);
  const runs = new RunService({
    store,
    runs: runsQueries,
    work,
    decisions,
    projects: projectsQueries,
    library,
    runtime,
    dataDir: dir,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
  });
  const triage = new TriageService({
    store,
    work,
    decisions,
    projects: projectsQueries,
    library,
    runtime,
    dataDir: dir,
    env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    auto: options.autoTriage ?? false,
  });
  // tests drive the scheduler with tick(); start() is never called
  const scheduler = new Scheduler({ store, queries: new SchedulerQueries(db), work, runs, runsQueries, projects: projectsQueries, logDir: join(dir, 'logs'), ...(options.now ? { now: options.now } : {}) });
  const app = createApp({ store, projects, work, runs, library, decisions, triage, scheduler, version: '0.0.0-test', port: PORT, webDist: null, keepAliveMs: 50 });
  return { db, store, projects, work, runs, library, decisions, triage, scheduler, app };
}
