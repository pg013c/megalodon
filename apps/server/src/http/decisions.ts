import { overrideDecisionBodySchema, type Decision } from '@megalodon/contracts';
import type { Hono } from 'hono';
import type { DecisionService } from '../decisions/service';
import { readBody } from './body';

export function decisionRoutes(app: Hono, decisions: DecisionService): void {
  app.get('/api/tasks/:id/decisions', (c) => c.json<Decision[]>(decisions.queries.forTask(c.req.param('id'))));

  app.post('/api/decisions/:id/override', async (c) => {
    const { outcome, rationale } = await readBody(c, overrideDecisionBodySchema);
    return c.json<Decision>(decisions.override(c.req.param('id'), outcome, rationale), 201);
  });
}
