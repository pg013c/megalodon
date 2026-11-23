import { scorecardQuerySchema, type Scorecard } from '@megalodon/contracts';
import type { Hono } from 'hono';
import { AppError } from '../errors';
import type { ProjectService } from '../projects/service';
import type { ScorecardService } from '../scorecard/service';

export function scorecardRoutes(app: Hono, scorecard: ScorecardService, projects: ProjectService): void {
  app.get('/api/scorecard', (c) => {
    const query = scorecardQuerySchema.safeParse({ projectId: c.req.query('projectId'), period: c.req.query('period') });
    if (!query.success) {
      const period = query.error.issues.some((i) => i.path[0] === 'period');
      throw new AppError(400, 'INVALID_REQUEST', period ? 'period must be one of 24h, 7d, 30d, all' : 'projectId must not be empty');
    }
    const { projectId, period } = query.data;
    // an unknown project is a 404, not an empty scorecard
    if (projectId) projects.get(projectId);
    return c.json<Scorecard>(scorecard.view(period, projectId ?? null));
  });
}
