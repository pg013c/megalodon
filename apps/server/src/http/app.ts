import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { ApiError, Health, StoredEvent } from '@megalodon/contracts';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { AppError, type ErrorStatus } from '../errors';
import type { EventStore } from '../events/store';
import type { ProjectService } from '../projects/service';
import type { DecisionService } from '../decisions/service';
import type { Library } from '../library/library';
import type { RunService } from '../runs/service';
import type { MergeService } from '../merge/service';
import { NeedsYouService } from '../needsYou/service';
import type { Scheduler } from '../scheduler/service';
import type { TriageService } from '../triage/service';
import type { WorkService } from '../work/service';
import { decisionRoutes } from './decisions';
import { projectRoutes } from './projects';
import { queueRoutes } from './queue';
import { runRoutes } from './runs';
import { workRoutes } from './work';

export interface AppDeps {
  store: EventStore;
  projects: ProjectService;
  work: WorkService;
  runs: RunService;
  library: Library;
  decisions: DecisionService;
  triage: TriageService;
  scheduler: Scheduler;
  merges: MergeService;
  version: string;
  port: number;
  /** Built web app to serve, or null in dev where Vite serves it. */
  webDist: string | null;
  /** Interval of SSE keep-alive comments. */
  keepAliveMs?: number;
}

export function createApp({ store, projects, work, runs, library, decisions, triage, scheduler, merges, version, port, webDist, keepAliveMs = 15_000 }: AppDeps): Hono {
  const app = new Hono();
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);

  // No authentication, so refuse any Host but our own (DNS rebinding, ADR-0017).
  app.use('*', async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    if (!allowedHosts.has(host)) return error(c, 403, 'FORBIDDEN_HOST', `Host "${host}" is not allowed`);
    await next();
  });

  app.get('/api/health', (c) =>
    c.json<Health>({ ok: true, name: 'megalodon', version, lastSeq: store.lastSeq() }),
  );

  const needsYou = new NeedsYouService({
    work: work.queries,
    runs: runs.queries,
    decisions: decisions.queries,
    projects: projects.queries,
    merges,
    scheduler,
  });
  projectRoutes(app, projects);
  workRoutes(app, work);
  runRoutes(app, runs, library);
  decisionRoutes(app, decisions);
  queueRoutes(app, work, triage, scheduler, merges, needsYou);

  // Live event feed from now on. A client that sends Last-Event-ID (a reconnecting EventSource) or
  // ?after=<seq> first receives what it missed.
  app.get('/api/stream', (c) =>
    streamSSE(c, async (stream) => {
      let chain = Promise.resolve();
      const send = (event: StoredEvent) => {
        chain = chain.then(() =>
          stream.writeSSE({ event: 'event', id: String(event.seq), data: JSON.stringify(event) }),
        );
      };
      const after = Number(c.req.header('last-event-id') ?? c.req.query('after') ?? store.lastSeq());
      // read and subscribe in the same tick: append is synchronous, so nothing slips between them
      if (Number.isInteger(after) && after >= 0) for (const event of store.read(after, Number.MAX_SAFE_INTEGER)) send(event);
      const unsubscribe = store.subscribe(send);
      stream.onAbort(unsubscribe);
      while (!stream.aborted) {
        await stream.sleep(keepAliveMs);
        if (!stream.aborted) await stream.write(': keep-alive\n\n');
      }
      unsubscribe();
    }),
  );

  app.all('/api/*', (c) => error(c, 404, 'NOT_FOUND', `No route ${c.req.method} ${c.req.path}`));

  if (webDist) {
    const index = readFileSync(join(webDist, 'index.html'), 'utf8');
    app.use('*', serveStatic({ root: webDist }));
    // client-side routes
    app.get('*', (c) => c.html(index));
  }

  app.onError((err, c) => {
    if (err instanceof AppError) return error(c, err.status, err.code, err.message);
    console.error(err);
    return error(c, 500, 'INTERNAL', err.message);
  });

  return app;
}

function error(c: Context, status: ErrorStatus, code: string, message: string) {
  return c.json<ApiError>({ error: { code, message } }, status);
}
