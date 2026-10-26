import { startRunBodySchema, type Agent, type Run, type RunDetails } from '@megalodon/contracts';
import type { Hono } from 'hono';
import type { AgentLibrary } from '../library/agents';
import type { RunService } from '../runs/service';
import { readBody } from './body';

export function runRoutes(app: Hono, runs: RunService, library: AgentLibrary): void {
  app.get('/api/agents', (c) => c.json<Agent[]>(library.list()));

  app.get('/api/tasks/:id/runs', (c) => c.json<Run[]>(runs.forTask(c.req.param('id'))));

  app.post('/api/tasks/:id/runs', async (c) => {
    const { agentId } = await readBody(c, startRunBodySchema);
    return c.json<Run>(await runs.start(c.req.param('id'), agentId), 201);
  });

  app.get('/api/runs/:id', (c) => c.json<RunDetails>(runs.details(c.req.param('id'))));

  app.post('/api/runs/:id/stop', (c) => c.json<Run>(runs.stop(c.req.param('id'))));
}
