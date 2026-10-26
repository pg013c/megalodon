import { join } from 'node:path';
import { apiErrorSchema, dependencySchema, queueViewSchema, schedulerStateSchema, taskDetailsSchema, taskSchema } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { initRepo } from '../test/repo';
import { createTestServer, url } from '../test/server';
import { useTempDir } from '../test/tempDir';

const tempDir = useTempDir();
const send = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

describe('queue routes', () => {
  it('edits dependencies, touch-sets and the queue over HTTP', async () => {
    const { app, projects, work } = createTestServer(tempDir());
    const project = await projects.connect(initRepo(join(tempDir(), 'shop')));
    const a = work.createTask(project.id, { kind: 'task', storyId: null, title: 'A', description: '' });
    const b = work.createTask(project.id, { kind: 'task', storyId: null, title: 'B', description: '' });

    const dep = dependencySchema.parse(
      await (await app.request(url(`/api/tasks/${b.id}/dependencies`), send('POST', { kind: 'code', target: { type: 'task', id: a.id } }))).json(),
    );
    const ext = dependencySchema.parse(
      await (await app.request(url(`/api/tasks/${b.id}/dependencies`), send('POST', { kind: 'external', description: 'Staging is up' }))).json(),
    );
    expect(dependencySchema.parse(await (await app.request(url(`/api/dependencies/${ext.id}/met`), send('POST'))).json()).met).toBe(true);
    expect((await app.request(url(`/api/dependencies/${dep.id}`), { method: 'DELETE' })).status).toBe(204);

    const touched = taskSchema.parse(await (await app.request(url(`/api/tasks/${b.id}/touches`), send('PUT', { touches: ['src/b'] }))).json());
    expect(touched.touches).toEqual(['src/b']);
    expect(taskSchema.parse(await (await app.request(url(`/api/tasks/${b.id}/queue`), send('POST'))).json()).status).toBe('ready');
    expect(taskSchema.parse(await (await app.request(url(`/api/tasks/${b.id}/front`), send('POST'))).json()).front).toBe(true);

    const details = taskDetailsSchema.parse(await (await app.request(url(`/api/tasks/${b.id}`))).json());
    expect(details.dependencies.map((d) => d.kind)).toEqual(['external']);

    const front = await app.request(url(`/api/tasks/${a.id}/front`), send('POST'));
    expect(apiErrorSchema.parse(await front.json()).error.code).toBe('NOT_QUEUED');
  });

  it('shows and controls the queue', async () => {
    const { app } = createTestServer(tempDir());
    expect(schedulerStateSchema.parse(await (await app.request(url('/api/queue/slots'), send('PUT', { slots: 4 }))).json()).slots).toBe(4);
    expect(schedulerStateSchema.parse(await (await app.request(url('/api/queue/pause'), send('POST'))).json()).paused).toBe('operator');
    const view = queueViewSchema.parse(await (await app.request(url('/api/queue'))).json());
    expect(view.state).toEqual({ slots: 4, paused: 'operator', pausedUntil: null });
    expect(schedulerStateSchema.parse(await (await app.request(url('/api/queue/resume'), send('POST'))).json()).paused).toBeNull();
    const bad = await app.request(url('/api/queue/slots'), send('PUT', { slots: 0 }));
    expect(apiErrorSchema.parse(await bad.json()).error.code).toBe('INVALID_REQUEST');
  });
});
