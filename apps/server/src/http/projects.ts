import {
  connectProjectBodySchema,
  setActiveProjectBodySchema,
  updateSettingsBodySchema,
  type Branch,
  type BranchDiff,
  type FilePatch,
  type Project,
  type Workspace,
} from '@megalodon/contracts';
import type { Hono } from 'hono';
import { AppError } from '../errors';
import type { ProjectService } from '../projects/service';
import { readBody } from './body';

export function projectRoutes(app: Hono, projects: ProjectService): void {
  app.get('/api/projects', (c) => c.json<Project[]>(projects.list()));

  app.post('/api/projects', async (c) => {
    const { path } = await readBody(c, connectProjectBodySchema);
    return c.json<Project>(await projects.connect(path), 201);
  });

  app.get('/api/projects/:id', (c) => c.json<Project>(projects.get(c.req.param('id'))));

  app.put('/api/projects/:id/settings', async (c) => {
    const { settings } = await readBody(c, updateSettingsBodySchema);
    return c.json<Project>(await projects.updateSettings(c.req.param('id'), settings));
  });

  app.delete('/api/projects/:id', (c) => {
    projects.disconnect(c.req.param('id'));
    return c.body(null, 204);
  });

  app.get('/api/projects/:id/branches', async (c) => c.json<Branch[]>(await projects.branches(c.req.param('id'))));

  app.post('/api/projects/:id/fetch', async (c) => c.json<Branch[]>(await projects.fetch(c.req.param('id'))));

  // Branch names contain slashes, so they travel as query parameters.
  app.get('/api/projects/:id/diff', async (c) => {
    const branch = requiredQuery(c.req.query('branch'), 'branch');
    const file = c.req.query('file');
    const id = c.req.param('id');
    if (file === undefined) return c.json<BranchDiff>(await projects.diff(id, branch));
    return c.json<FilePatch>(await projects.filePatch(id, branch, file));
  });

  app.get('/api/workspace', (c) => c.json<Workspace>({ activeProjectId: projects.activeProjectId() }));

  app.put('/api/workspace/active-project', async (c) => {
    const { projectId } = await readBody(c, setActiveProjectBodySchema);
    projects.setActive(projectId);
    return c.json<Workspace>({ activeProjectId: projects.activeProjectId() });
  });
}

function requiredQuery(value: string | undefined, name: string): string {
  if (!value) throw new AppError(400, 'INVALID_REQUEST', `Query parameter "${name}" is required`);
  return value;
}
