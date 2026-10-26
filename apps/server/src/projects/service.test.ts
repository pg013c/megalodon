import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { projectEvents } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { initRepo, sh } from '../test/repo';
import { createTestServer } from '../test/server';
import { useTempDir } from '../test/tempDir';

const tempDir = useTempDir();

const pnpmProject = {
  'package.json': JSON.stringify({ scripts: { test: 'vitest', typecheck: 'tsc', build: 'vite build' } }),
  'pnpm-lock.yaml': 'lockfileVersion: 9\n',
};

describe('ProjectService', () => {
  it('connects a repository root with detected settings and makes the first project active', async () => {
    const { projects } = createTestServer(tempDir());
    const root = initRepo(join(tempDir(), 'shop'), pnpmProject);

    const project = await projects.connect(root);

    expect(project).toMatchObject({ name: 'shop' });
    expect(project.settings).toEqual({
      baseBranch: 'main',
      packageManager: 'pnpm',
      setup: ['pnpm install --frozen-lockfile'],
      checks: [
        { name: 'typecheck', command: 'pnpm run typecheck', required: true, timeoutSec: 900 },
        { name: 'test', command: 'pnpm run test', required: true, timeoutSec: 900 },
      ],
      maxFixPasses: 2,
      sensitivePaths: [],
      knowledge: { location: 'repo', path: 'docs' },
      maxParallel: null,
    });
    expect(projects.activeProjectId()).toBe(project.id);
  });

  it('does not write anything into the connected repository', async () => {
    const { projects } = createTestServer(tempDir());
    const root = initRepo(join(tempDir(), 'clean'), pnpmProject);
    await projects.connect(root);
    expect(sh(root, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(root, '.megalodon'))).toBe(false);
  });

  it('keeps the first project active when more are connected', async () => {
    const { projects } = createTestServer(tempDir());
    const first = await projects.connect(initRepo(join(tempDir(), 'a')));
    await projects.connect(initRepo(join(tempDir(), 'b')));
    expect(projects.activeProjectId()).toBe(first.id);
  });

  it.each([
    ['a missing folder', (dir: string) => join(dir, 'missing'), 'NOT_A_DIRECTORY'],
    ['a plain folder', (dir: string) => (mkdirSync(join(dir, 'plain')), join(dir, 'plain')), 'NOT_A_REPOSITORY'],
    ['a relative path', () => 'relative/path', 'PATH_NOT_ABSOLUTE'],
  ])('rejects %s', async (_, makePath, code) => {
    const { projects } = createTestServer(tempDir());
    await expect(projects.connect(makePath(tempDir()))).rejects.toMatchObject({ code });
  });

  it('rejects a folder inside a repository', async () => {
    const { projects } = createTestServer(tempDir());
    const root = initRepo(join(tempDir(), 'r'), { 'src/a.ts': '' });
    await expect(projects.connect(join(root, 'src'))).rejects.toMatchObject({ code: 'NOT_REPOSITORY_ROOT' });
  });

  it('rejects a repository without commits', async () => {
    const { projects } = createTestServer(tempDir());
    const root = join(tempDir(), 'empty');
    mkdirSync(root);
    sh(root, 'init', '-q');
    await expect(projects.connect(root)).rejects.toMatchObject({ code: 'NO_COMMITS' });
  });

  it('rejects the same repository twice, also through a symlink', async () => {
    const { projects } = createTestServer(tempDir());
    const root = initRepo(join(tempDir(), 'r'));
    const link = join(tempDir(), 'link');
    symlinkSync(root, link);
    await projects.connect(root);
    await expect(projects.connect(link)).rejects.toMatchObject({ code: 'ALREADY_CONNECTED', status: 409 });
  });

  it('updates settings and refuses a base branch that does not exist', async () => {
    const { projects } = createTestServer(tempDir());
    const project = await projects.connect(initRepo(join(tempDir(), 'r'), pnpmProject));

    const updated = await projects.updateSettings(project.id, { ...project.settings, sensitivePaths: ['src/payments/**'] });
    expect(updated.settings.sensitivePaths).toEqual(['src/payments/**']);

    await expect(
      projects.updateSettings(project.id, { ...project.settings, baseBranch: 'develop' }),
    ).rejects.toMatchObject({ code: 'BASE_BRANCH_NOT_FOUND' });
  });

  it('clears the active project when it is disconnected, and can connect it again', async () => {
    const { projects } = createTestServer(tempDir());
    const root = initRepo(join(tempDir(), 'r'));
    const project = await projects.connect(root);

    projects.disconnect(project.id);
    expect(projects.list()).toEqual([]);
    expect(projects.activeProjectId()).toBeNull();

    const again = await projects.connect(root);
    expect(again.id).not.toBe(project.id);
  });

  it('switches the active project and records nothing when it does not change', async () => {
    const { projects, store } = createTestServer(tempDir());
    const a = await projects.connect(initRepo(join(tempDir(), 'a')));
    const b = await projects.connect(initRepo(join(tempDir(), 'b')));

    projects.setActive(b.id);
    const seq = store.lastSeq();
    projects.setActive(b.id);

    expect(projects.activeProjectId()).toBe(b.id);
    expect(store.lastSeq()).toBe(seq);
    expect(() => projects.setActive('nope')).toThrow(expect.objectContaining({ code: 'PROJECT_NOT_FOUND' }));
    projects.setActive(null);
    expect(projects.activeProjectId()).toBeNull();
    expect(a.id).toBeTruthy();
  });

  it('rebuilds projects and the active project from the log', async () => {
    const { projects, store } = createTestServer(tempDir());
    const a = await projects.connect(initRepo(join(tempDir(), 'a'), pnpmProject));
    const b = await projects.connect(initRepo(join(tempDir(), 'b')));
    await projects.updateSettings(a.id, { ...a.settings, maxFixPasses: 4 });
    projects.setActive(b.id);
    const c = await projects.connect(initRepo(join(tempDir(), 'c')));
    projects.disconnect(c.id);
    const before = { list: projects.list(), active: projects.activeProjectId() };

    store.rebuild();

    expect({ list: projects.list(), active: projects.activeProjectId() }).toEqual(before);
    expect(store.read().map((e) => e.type)).toContain(projectEvents.disconnected);
  });
});
