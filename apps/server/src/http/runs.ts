import { startRunBodySchema, type Agent, type Pipeline, type Run, type RunDetails } from '@megalodon/contracts';
import type { Hono } from 'hono';
import type { Library } from '../library/library';
import type { RunService } from '../runs/service';
import { readBody } from './body';

export function runRoutes(app: Hono, runs: RunService, library: Library): void {
  app.get('/api/agents', (c) => c.json<Agent[]>(library.agents()));

  app.get('/api/pipelines', (c) => c.json<Pipeline[]>(library.pipelines()));

  app.get('/api/tasks/:id/runs', (c) => c.json<Run[]>(runs.forTask(c.req.param('id'))));

  app.post('/api/tasks/:id/runs', async (c) => {
    const { pipelineId, agentId } = await readBody(c, startRunBodySchema);
    const source = agentId ? { agentId } : { pipelineId: pipelineId ?? 'feature' };
    return c.json<Run>(await runs.start(c.req.param('id'), source), 201);
  });

  app.get('/api/runs/:id', (c) => c.json<RunDetails>(runs.details(c.req.param('id'))));

  app.post('/api/runs/:id/stop', (c) => c.json<Run>(runs.stop(c.req.param('id'))));
}
