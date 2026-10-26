import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initRepo } from '../test/repo';
import { createTestServer } from '../test/server';
import { useTempDir } from '../test/tempDir';
import { touchesOverlap, touchPrefix } from './readiness';

const tempDir = useTempDir();
const SYSTEM = { kind: 'system' } as const;

async function setup() {
  const server = createTestServer(tempDir());
  const project = await server.projects.connect(initRepo(join(tempDir(), 'shop')));
  const task = (title: string, storyId: string | null = null) => server.work.createTask(project.id, { kind: 'task', storyId, title, description: '' });
  const manual = (title: string) => server.work.createTask(project.id, { kind: 'manual', storyId: null, title, description: '' });
  const merge = (id: string) => {
    for (const to of ['ready', 'running', 'merging', 'done']) server.work.transition(id, to, null, SYSTEM);
  };
  return { ...server, project, task, manual, merge };
}

describe('dependencies and requirements', () => {
  it('meets a code dependency when its task is merged', async () => {
    const { work, task, merge } = await setup();
    const users = task('Users');
    const payments = task('Payments');
    work.addDependency(payments.id, { kind: 'code', target: { type: 'task', id: users.id }, description: 'needs accounts', command: null });

    expect(work.details(payments.id).requirements).toEqual([
      { kind: 'code', label: '#1 Users', met: false, dependencyId: expect.any(String), ref: { type: 'task', id: users.id, number: 1 } },
    ]);
    merge(users.id);
    expect(work.details(payments.id).requirements[0]?.met).toBe(true);
  });

  it('meets a manual dependency when the manual task is done, and a story when all of it is merged', async () => {
    const { work, task, manual, merge, project } = await setup();
    const key = manual('Create Stripe key');
    const story = work.createStory(project.id, { title: 'Accounts', description: '' });
    const a = task('Sign up', story.id);
    const b = task('Log in', story.id);
    const payments = task('Payments');
    work.addDependency(payments.id, { kind: 'manual', target: { type: 'task', id: key.id }, description: '', command: null });
    work.addDependency(payments.id, { kind: 'code', target: { type: 'story', id: story.id }, description: '', command: null });

    const met = () => work.details(payments.id).requirements.map((r) => r.met);
    expect(met()).toEqual([false, false]);
    work.complete(key.id);
    merge(a.id);
    expect(met()).toEqual([true, false]);
    merge(b.id);
    expect(met()).toEqual([true, true]);
  });

  it('meets an external dependency when it is marked as met', async () => {
    const { work, task } = await setup();
    const t = task('Call the partner API');
    const dep = work.addDependency(t.id, { kind: 'external', target: null, description: 'Partner API on staging', command: null });
    expect(work.details(t.id).requirements[0]).toMatchObject({ kind: 'external', label: 'Partner API on staging', met: false });
    work.markMet(dep.id);
    expect(work.details(t.id).requirements[0]?.met).toBe(true);
  });

  it('refuses self-references, other projects, wrong kinds and cycles', async () => {
    const { work, task, manual, projects } = await setup();
    const a = task('A');
    const b = task('B');
    const other = await projects.connect(initRepo(join(tempDir(), 'blog')));
    const elsewhere = work.createTask(other.id, { kind: 'task', storyId: null, title: 'X', description: '' });
    const code = (from: string, to: string) => work.addDependency(from, { kind: 'code', target: { type: 'task', id: to }, description: '', command: null });

    expect(() => code(a.id, a.id)).toThrow(expect.objectContaining({ code: 'DEPENDS_ON_ITSELF' }));
    expect(() => code(a.id, elsewhere.id)).toThrow(expect.objectContaining({ code: 'TARGET_IN_OTHER_PROJECT' }));
    expect(() => work.addDependency(a.id, { kind: 'manual', target: { type: 'task', id: b.id }, description: '', command: null })).toThrow(
      expect.objectContaining({ code: 'NOT_A_MANUAL_TASK' }),
    );
    code(a.id, b.id);
    expect(() => code(b.id, a.id)).toThrow(expect.objectContaining({ code: 'DEPENDENCY_CYCLE' }));
    expect(manual('M').kind).toBe('manual');
  });

  it('removes dependencies and rebuilds them, touch-sets and pipelines from the log', async () => {
    const { work, task, store } = await setup();
    const a = task('A');
    const b = task('B');
    const dep = work.addDependency(b.id, { kind: 'code', target: { type: 'task', id: a.id }, description: 'x', command: null });
    work.addDependency(b.id, { kind: 'external', target: null, description: 'y', command: 'true' });
    work.setTouches(b.id, ['src/b/**']);
    work.setPipeline(b.id, 'feature');
    work.removeDependency(dep.id);
    const before = work.details(b.id);

    store.rebuild();

    expect(work.details(b.id)).toEqual(before);
    expect(before.dependencies.map((d) => d.kind)).toEqual(['external']);
    expect(before.task.touches).toEqual(['src/b/**']);
  });
});

describe('touch-sets', () => {
  it('reduce globs to the directory they cover', () => {
    expect(touchPrefix('src/payments/**')).toBe('src/payments');
    expect(touchPrefix('./src/a.ts')).toBe('src/a.ts');
    expect(touchPrefix('**/*.ts')).toBe('');
  });

  it('overlap when one lies inside the other', () => {
    expect(touchesOverlap(['src/payments/**'], ['src/payments/stripe.ts'])).toBe(true);
    expect(touchesOverlap(['src/payments'], ['src/pay'])).toBe(false);
    expect(touchesOverlap(['src/a'], ['docs'])).toBe(false);
    expect(touchesOverlap(['**/*.ts'], ['docs'])).toBe(true);
  });
});
