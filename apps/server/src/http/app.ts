import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { ApiError, Health, StoredEvent } from '@megalodon/contracts';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { EventStore } from '../events/store';

export interface AppDeps {
  store: EventStore;
  version: string;
  port: number;
  /** Built web app to serve, or null in dev where Vite serves it. */
  webDist: string | null;
  /** Interval of SSE keep-alive comments. */
  keepAliveMs?: number;
}

export function createApp({ store, version, port, webDist, keepAliveMs = 15_000 }: AppDeps): Hono {
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

  // Live event feed. A reconnecting client sends Last-Event-ID and first receives what it missed.
  app.get('/api/stream', (c) =>
    streamSSE(c, async (stream) => {
      let chain = Promise.resolve();
      const send = (event: StoredEvent) => {
        chain = chain.then(() =>
          stream.writeSSE({ event: 'event', id: String(event.seq), data: JSON.stringify(event) }),
        );
      };
      const lastId = Number(c.req.header('last-event-id') ?? 0);
      // read and subscribe in the same tick: append is synchronous, so nothing slips between them
      for (const event of store.read(Number.isFinite(lastId) ? lastId : 0, Number.MAX_SAFE_INTEGER)) send(event);
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
    console.error(err);
    return error(c, 500, 'INTERNAL', err.message);
  });

  return app;
}

function error(c: Context, status: 403 | 404 | 500, code: string, message: string) {
  return c.json<ApiError>({ error: { code, message } }, status);
}
