import { join } from 'node:path';
import { apiErrorSchema, projectWorkSchema, storySchema, taskDetailsSchema, taskSchema } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { initRepo } from '../test/repo';
import { createTestServer, url } from '../test/server';
import { useTempDir } from '../test/tempDir';

const tempDir = useTempDir();

const send = (method: string, body?: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body ?? {}),
});

describe('work routes', () => {
  it('creates and reads the board, details and status changes over HTTP', async () => {
    const { app, projects } = createTestServer(tempDir());
    const project = await projects.connect(initRepo(join(tempDir(), 'shop')));

    const story = storySchema.parse(
      await (await app.request(url(`/api/projects/${project.id}/stories`), send('POST', { title: 'Users' }))).json(),
    );
    const created = await app.request(
      url(`/api/projects/${project.id}/tasks`),
      send('POST', { kind: 'manual', storyId: story.id, title: 'Create OAuth app' }),
    );
    expect(created.status).toBe(201);
    const manual = taskSchema.parse(await created.json());

    const done = taskSchema.parse(await (await app.request(url(`/api/tasks/${manual.id}/complete`), send('POST'))).json());
    expect(done.status).toBe('done');

    const board = projectWorkSchema.parse(await (await app.request(url(`/api/projects/${project.id}/work`))).json());
    expect(board.stories[0]).toMatchObject({ status: 'done', doneCount: 1 });

    const details = taskDetailsSchema.parse(await (await app.request(url(`/api/tasks/${manual.id}`))).json());
    expect(details.story?.id).toBe(story.id);
    expect(details.history).toHaveLength(2);
  });

  it('answers invalid input and transitions with stable codes', async () => {
    const { app, projects } = createTestServer(tempDir());
    const project = await projects.connect(initRepo(join(tempDir(), 'shop')));

    const noTitle = await app.request(url(`/api/projects/${project.id}/tasks`), send('POST', { kind: 'task', title: ' ' }));
    expect(apiErrorSchema.parse(await noTitle.json()).error.code).toBe('INVALID_REQUEST');

    const task = taskSchema.parse(
      await (await app.request(url(`/api/projects/${project.id}/tasks`), send('POST', { kind: 'task', title: 'T' }))).json(),
    );
    await app.request(url(`/api/tasks/${task.id}/cancel`), send('POST', { reason: 'dup' }));
    const again = await app.request(url(`/api/tasks/${task.id}/cancel`), send('POST'));
    expect(again.status).toBe(409);
    expect(apiErrorSchema.parse(await again.json()).error.code).toBe('INVALID_TRANSITION');

    const missing = await app.request(url('/api/tasks/nope'));
    expect(apiErrorSchema.parse(await missing.json()).error.code).toBe('TASK_NOT_FOUND');
  });
});
