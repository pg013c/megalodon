import { join } from 'node:path';
import { apiErrorSchema, healthSchema } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db';
import { EventStore } from '../events/store';
import { useTempDir } from '../test/tempDir';
import { createApp } from './app';

const tempDir = useTempDir();

function setup() {
  const store = new EventStore(openDatabase(join(tempDir(), 'test.db')), []);
  const app = createApp({ store, version: '0.0.0-test', port: 4600, webDist: null, keepAliveMs: 50 });
  return { app, store };
}

const url = (path: string) => `http://127.0.0.1:4600${path}`;

describe('HTTP app', () => {
  it('reports health with the last event sequence', async () => {
    const { app, store } = setup();
    store.append([{ type: 'a', stream: 's', data: null, actor: { kind: 'system' } }]);

    const res = await app.request(url('/api/health'));
    expect(res.status).toBe(200);
    expect(healthSchema.parse(await res.json())).toMatchObject({ version: '0.0.0-test', lastSeq: 1 });
  });

  it('refuses a foreign Host header', async () => {
    const { app } = setup();
    const res = await app.request(url('/api/health'), { headers: { host: 'evil.example:4600' } });
    expect(res.status).toBe(403);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe('FORBIDDEN_HOST');
  });

  it('accepts localhost on our port', async () => {
    const { app } = setup();
    const res = await app.request(url('/api/health'), { headers: { host: 'localhost:4600' } });
    expect(res.status).toBe(200);
  });

  it('answers unknown API routes with a JSON 404', async () => {
    const { app } = setup();
    const res = await app.request(url('/api/nope'));
    expect(res.status).toBe(404);
    expect(apiErrorSchema.parse(await res.json()).error.code).toBe('NOT_FOUND');
  });

  it('streams missed events after Last-Event-ID, then live ones', async () => {
    const { app, store } = setup();
    const append = (type: string) => store.append([{ type, stream: 's', data: null, actor: { kind: 'system' } }]);
    append('first');
    append('second');

    const controller = new AbortController();
    const res = await app.request(url('/api/stream'), {
      headers: { 'last-event-id': '1' },
      signal: controller.signal,
    });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream ended before "${needle}"`);
        text += decoder.decode(value, { stream: true });
      }
    };

    await readUntil('"type":"second"');
    append('third');
    await readUntil('"type":"third"');
    controller.abort();
    await reader.cancel().catch(() => {});

    expect(text).not.toContain('"type":"first"');
    expect(text).toContain('id: 2');
    expect(text).toContain('id: 3');
  });
});
