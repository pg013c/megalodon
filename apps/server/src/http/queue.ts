import {
  addDependencyBodySchema,
  setPipelineBodySchema,
  setSlotsBodySchema,
  setTouchesBodySchema,
  type Dependency,
  type QueueView,
  type SchedulerState,
  type Task,
} from '@megalodon/contracts';
import type { Hono } from 'hono';
import type { Scheduler } from '../scheduler/service';
import type { TriageService } from '../triage/service';
import type { WorkService } from '../work/service';
import { readBody } from './body';

export function queueRoutes(app: Hono, work: WorkService, triage: TriageService, scheduler: Scheduler): void {
  const task = (id: string) => work.queries.task(id)!;

  app.post('/api/tasks/:id/triage', (c) => {
    triage.request(c.req.param('id'));
    return c.json<Task>(task(c.req.param('id')), 202);
  });
  app.post('/api/tasks/:id/queue', (c) => c.json<Task>(work.queue(c.req.param('id'))));
  app.post('/api/tasks/:id/retry', (c) => c.json<Task>(work.retry(c.req.param('id'))));
  app.post('/api/tasks/:id/front', (c) => c.json<Task>(work.moveToFront(c.req.param('id'))));

  app.put('/api/tasks/:id/touches', async (c) => {
    const { touches } = await readBody(c, setTouchesBodySchema);
    return c.json<Task>(work.setTouches(c.req.param('id'), touches));
  });
  app.put('/api/tasks/:id/pipeline', async (c) => {
    const { pipelineId } = await readBody(c, setPipelineBodySchema);
    return c.json<Task>(work.setPipeline(c.req.param('id'), pipelineId));
  });

  app.post('/api/tasks/:id/dependencies', async (c) => {
    const body = await readBody(c, addDependencyBodySchema);
    const input =
      body.kind === 'external'
        ? { kind: body.kind, target: null, description: body.description, command: body.command }
        : { kind: body.kind, target: body.target, description: body.description, command: null };
    return c.json<Dependency>(work.addDependency(c.req.param('id'), input), 201);
  });
  app.delete('/api/dependencies/:id', (c) => {
    work.removeDependency(c.req.param('id'));
    return c.body(null, 204);
  });
  app.post('/api/dependencies/:id/met', (c) => c.json<Dependency>(work.markMet(c.req.param('id'))));

  app.get('/api/queue', (c) => c.json<QueueView>(scheduler.view()));
  app.put('/api/queue/slots', async (c) => {
    const { slots } = await readBody(c, setSlotsBodySchema);
    return c.json<SchedulerState>(scheduler.setSlots(slots));
  });
  app.post('/api/queue/pause', (c) => c.json<SchedulerState>(scheduler.pause()));
  app.post('/api/queue/resume', (c) => c.json<SchedulerState>(scheduler.resume()));
}
