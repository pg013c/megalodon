import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { loadConfig } from './config';
import { openDatabase } from './db';
import { EventStore } from './events/store';
import { createApp } from './http/app';
import { acquireLock, DataDirLockedError } from './lock';
import { ProjectsProjection, ProjectsQueries } from './projects/projection';
import { ProjectService } from './projects/service';
import { DecisionsProjection, DecisionsQueries } from './decisions/projection';
import { DecisionService } from './decisions/service';
import { Library } from './library/library';
import { RunsProjection, RunsQueries } from './runs/projection';
import { agentEnv, RunService } from './runs/service';
import { ClaudeRuntime } from './runtime/claude';
import { MergeProjection, MergeQueries } from './merge/projection';
import { UsageProjection, UsageQueries } from './overview/usage';
import { MergeService } from './merge/service';
import { SchedulerProjection, SchedulerQueries } from './scheduler/projection';
import { Scheduler } from './scheduler/service';
import { TriageService } from './triage/service';
import { WorkProjection, WorkQueries } from './work/projection';
import { WorkService } from './work/service';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
const builtinLibrary = fileURLToPath(new URL('../../../library', import.meta.url));

const config = loadConfig(process.env, webDist);
mkdirSync(config.dataDir, { recursive: true });

let releaseLock: () => void;
try {
  releaseLock = acquireLock(config.dataDir, config.port);
} catch (error) {
  if (error instanceof DataDirLockedError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const db = openDatabase(join(config.dataDir, 'megalodon.db'));
const store = new EventStore(db, [new ProjectsProjection(), new WorkProjection(), new RunsProjection(), new DecisionsProjection(), new SchedulerProjection(), new MergeProjection(), new UsageProjection()]);
const projectsQueries = new ProjectsQueries(db);
const projects = new ProjectService(store, projectsQueries);
const work = new WorkService(store, new WorkQueries(db), projectsQueries);
const library = new Library([
  { source: 'builtin', path: builtinLibrary },
  { source: 'library', path: join(config.dataDir, 'library') },
]);
const decisions = new DecisionService(store, new DecisionsQueries(db));
const env = agentEnv(process.env);
const runtime = new ClaudeRuntime();
const runsQueries = new RunsQueries(db);
const runs = new RunService({
  store,
  runs: runsQueries,
  work,
  decisions,
  projects: projectsQueries,
  library,
  runtime,
  dataDir: config.dataDir,
  env,
});
const triage = new TriageService({ store, work, decisions, projects: projectsQueries, library, runtime, dataDir: config.dataDir, env, auto: true });
const merges = new MergeService({
  store,
  queries: new MergeQueries(db),
  work,
  runs: runsQueries,
  decisions,
  projects: projectsQueries,
  library,
  runtime,
  dataDir: config.dataDir,
  env,
});
const scheduler = new Scheduler({
  store,
  mergeBlocks: () => merges.blocks(),
  queries: new SchedulerQueries(db),
  work,
  runs,
  runsQueries,
  projects: projectsQueries,
  logDir: join(config.dataDir, 'logs'),
});
runs.recover();
triage.recover();
await merges.recover();
merges.start();
scheduler.start();
const app = createApp({ store, projects, work, runs, library, decisions, triage, scheduler, merges, usage: new UsageQueries(db), version: pkg.version, port: config.port, webDist: config.webDist });

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`Megalodon ${pkg.version} on http://${config.host}:${info.port} (data: ${config.dataDir})`);
});

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  // runs keep their state as running, so the next start recovers them
  scheduler.stop();
  merges.stop();
  void runs.shutdown();
  server.close(() => {
    db.close();
    releaseLock();
    process.exit(0);
  });
  // open SSE streams keep the server from closing
  setTimeout(() => {
    db.close();
    releaseLock();
    process.exit(0);
  }, 2_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
