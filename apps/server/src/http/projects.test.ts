import { join } from 'node:path';
import { apiErrorSchema, branchDiffSchema, branchSchema, projectSchema, workspaceSchema } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { commitAll, initRepo, sh, write } from '../test/repo';
import { createTestServer, url } from '../test/server';
import { useTempDir } from '../test/tempDir';

const tempDir = useTempDir();

const json = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

describe('project routes', () => {
  it('connects, lists, reads branches and diffs over HTTP', async () => {
    const { app } = createTestServer(tempDir());
    const root = initRepo(join(tempDir(), 'shop'));
    sh(root, 'checkout', '-q', '-b', 'feature/pay');
    write(root, { 'pay.ts': 'export {}\n' });
    commitAll(root, 'pay');
    sh(root, 'checkout', '-q', 'main');

    const created = await app.request(url('/api/projects'), json({ path: root }));
    expect(created.status).toBe(201);
    const project = projectSchema.parse(await created.json());

    const list = await (await app.request(url('/api/projects'))).json();
    expect(projectSchema.array().parse(list)).toHaveLength(1);

    const workspace = workspaceSchema.parse(await (await app.request(url('/api/workspace'))).json());
    expect(workspace.activeProjectId).toBe(project.id);

    const branches = branchSchema.array().parse(await (await app.request(url(`/api/projects/${project.id}/branches`))).json());
    expect(branches.map((b) => b.name).sort()).toEqual(['feature/pay', 'main']);

    const diff = branchDiffSchema.parse(
      await (await app.request(url(`/api/projects/${project.id}/diff?branch=${encodeURIComponent('feature/pay')}`))).json(),
    );
    expect(diff.files.map((f) => f.path)).toEqual(['pay.ts']);

    const patch = await (
      await app.request(url(`/api/projects/${project.id}/diff?branch=feature%2Fpay&file=pay.ts`))
    ).json();
    expect(patch).toMatchObject({ path: 'pay.ts', truncated: false });
  });

  it('answers errors with stable codes', async () => {
    const { app } = createTestServer(tempDir());

    const notRepo = await app.request(url('/api/projects'), json({ path: tempDir() }));
    expect(notRepo.status).toBe(400);
    expect(apiErrorSchema.parse(await notRepo.json()).error.code).toBe('NOT_A_REPOSITORY');

    const badBody = await app.request(url('/api/projects'), json({ nope: 1 }));
    expect(apiErrorSchema.parse(await badBody.json()).error.code).toBe('INVALID_REQUEST');

    const missing = await app.request(url('/api/projects/nope'));
    expect(missing.status).toBe(404);
    expect(apiErrorSchema.parse(await missing.json()).error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('saves settings and switches the active project', async () => {
    const { app } = createTestServer(tempDir());
    const a = projectSchema.parse(await (await app.request(url('/api/projects'), json({ path: initRepo(join(tempDir(), 'a')) }))).json());
    const b = projectSchema.parse(await (await app.request(url('/api/projects'), json({ path: initRepo(join(tempDir(), 'b')) }))).json());

    const saved = await app.request(url(`/api/projects/${a.id}/settings`), {
      ...json({ settings: { ...a.settings, sensitivePaths: ['src/auth/**'] } }),
      method: 'PUT',
    });
    expect(projectSchema.parse(await saved.json()).settings.sensitivePaths).toEqual(['src/auth/**']);

    const switched = await app.request(url('/api/workspace/active-project'), { ...json({ projectId: b.id }), method: 'PUT' });
    expect(workspaceSchema.parse(await switched.json()).activeProjectId).toBe(b.id);

    const removed = await app.request(url(`/api/projects/${b.id}`), { method: 'DELETE' });
    expect(removed.status).toBe(204);
    expect(workspaceSchema.parse(await (await app.request(url('/api/workspace'))).json()).activeProjectId).toBeNull();
  });
});
