import { scorecardQuerySchema, scorecardRunsQuerySchema, type Scorecard, type ScorecardRuns } from '@megalodon/contracts';
import type { Hono } from 'hono';
import { AppError } from '../errors';
import type { ProjectService } from '../projects/service';
import type { ScorecardService, ScorecardTarget } from '../scorecard/service';

const PERIOD = 'period must be one of 24h, 7d, 30d, all';

export function scorecardRoutes(app: Hono, scorecard: ScorecardService, projects: ProjectService): void {
  app.get('/api/scorecard/runs', (c) => {
    const query = scorecardRunsQuerySchema.safeParse({
      projectId: c.req.query('projectId'),
      period: c.req.query('period'),
      agentId: c.req.query('agentId'),
      agentVersion: c.req.query('agentVersion'),
      pipelineId: c.req.query('pipelineId'),
      pipelineVersion: c.req.query('pipelineVersion'),
    });
    if (!query.success) {
      const field = query.error.issues[0]?.path[0];
      throw new AppError(
        400,
        'INVALID_REQUEST',
        field === 'period' ? PERIOD : field === 'projectId' ? 'projectId must not be empty' : 'give agentId and agentVersion, or pipelineId and pipelineVersion',
      );
    }
    const { projectId, period, agentId, agentVersion, pipelineId, pipelineVersion } = query.data;
    if (projectId) projects.get(projectId);
    const target: ScorecardTarget = agentId && agentVersion ? { kind: 'agent', id: agentId, version: agentVersion } : { kind: 'pipeline', id: pipelineId!, version: pipelineVersion! };
    return c.json<ScorecardRuns>(scorecard.runs(target, period, projectId ?? null));
  });

  app.get('/api/scorecard', (c) => {
    const query = scorecardQuerySchema.safeParse({ projectId: c.req.query('projectId'), period: c.req.query('period') });
    if (!query.success) {
      const period = query.error.issues.some((i) => i.path[0] === 'period');
      throw new AppError(400, 'INVALID_REQUEST', period ? PERIOD : 'projectId must not be empty');
    }
    const { projectId, period } = query.data;
    // an unknown project is a 404, not an empty scorecard
    if (projectId) projects.get(projectId);
    return c.json<Scorecard>(scorecard.view(period, projectId ?? null));
  });
}
