import {
  createStoryBodySchema,
  createTaskBodySchema,
  reasonBodySchema,
  updateStoryBodySchema,
  updateTaskBodySchema,
  type ProjectWork,
  type Story,
  type Task,
  type TaskDetails,
} from '@megalodon/contracts';
import type { Hono } from 'hono';
import type { WorkService } from '../work/service';
import { readBody } from './body';

export function workRoutes(app: Hono, work: WorkService): void {
  app.get('/api/projects/:id/work', (c) => c.json<ProjectWork>(work.work(c.req.param('id'))));

  app.post('/api/projects/:id/stories', async (c) => {
    const body = await readBody(c, createStoryBodySchema);
    return c.json<Story>(work.createStory(c.req.param('id'), body), 201);
  });

  app.patch('/api/stories/:id', async (c) => {
    const body = await readBody(c, updateStoryBodySchema);
    return c.json<Story>(work.updateStory(c.req.param('id'), body));
  });

  app.post('/api/projects/:id/tasks', async (c) => {
    const body = await readBody(c, createTaskBodySchema);
    return c.json<Task>(work.createTask(c.req.param('id'), body), 201);
  });

  app.get('/api/tasks/:id', (c) => c.json<TaskDetails>(work.details(c.req.param('id'))));

  app.patch('/api/tasks/:id', async (c) => {
    const body = await readBody(c, updateTaskBodySchema);
    return c.json<Task>(work.updateTask(c.req.param('id'), body));
  });

  app.post('/api/tasks/:id/cancel', async (c) => {
    const { reason } = await readBody(c, reasonBodySchema);
    return c.json<Task>(work.cancel(c.req.param('id'), reason));
  });

  app.post('/api/tasks/:id/complete', (c) => c.json<Task>(work.complete(c.req.param('id'))));

  app.post('/api/tasks/:id/reopen', async (c) => {
    const { reason } = await readBody(c, reasonBodySchema);
    return c.json<Task>(work.reopen(c.req.param('id'), reason));
  });
}
