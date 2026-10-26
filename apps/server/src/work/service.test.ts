import { join } from 'node:path';
import { taskStream, workEvents } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { initRepo } from '../test/repo';
import { createTestServer } from '../test/server';
import { useTempDir } from '../test/tempDir';

const tempDir = useTempDir();

async function setup() {
  const server = createTestServer(tempDir());
  const project = await server.projects.connect(initRepo(join(tempDir(), 'shop')));
  const SYSTEM = { kind: 'system' } as const;
  return { ...server, project, SYSTEM };
}

describe('WorkService', () => {
  it('creates stories, tasks and manual tasks with shared per-project numbers', async () => {
    const { work, project } = await setup();
    const story = work.createStory(project.id, { title: 'Payments', description: '' });
    const task = work.createTask(project.id, { kind: 'task', storyId: story.id, title: 'Checkout API', description: 'x' });
    const manual = work.createTask(project.id, { kind: 'manual', storyId: story.id, title: 'Create Stripe key', description: '' });
    const loose = work.createTask(project.id, { kind: 'task', storyId: null, title: 'Fix typo', description: '' });

    expect([story.number, task.number, manual.number, loose.number]).toEqual([1, 2, 3, 4]);
    expect(task.status).toBe('backlog');
    expect(manual.status).toBe('todo');
    expect(loose.storyId).toBeNull();

    const board = work.work(project.id);
    expect(board.tasks.map((t) => t.title)).toEqual(['Checkout API', 'Create Stripe key', 'Fix typo']);
    expect(board.stories[0]).toMatchObject({ title: 'Payments', status: 'needs_you', taskCount: 2, doneCount: 0 });
  });

  it('numbers each project on its own', async () => {
    const { work, projects, project } = await setup();
    const other = await projects.connect(initRepo(join(tempDir(), 'blog')));
    work.createTask(project.id, { kind: 'task', storyId: null, title: 'a', description: '' });
    expect(work.createTask(other.id, { kind: 'task', storyId: null, title: 'b', description: '' }).number).toBe(1);
  });

  it('refuses a story from another project', async () => {
    const { work, projects, project } = await setup();
    const other = await projects.connect(initRepo(join(tempDir(), 'blog')));
    const story = work.createStory(other.id, { title: 's', description: '' });
    expect(() => work.createTask(project.id, { kind: 'task', storyId: story.id, title: 't', description: '' })).toThrow(
      expect.objectContaining({ code: 'STORY_IN_OTHER_PROJECT' }),
    );
  });

  it('completes, reopens and cancels manual tasks, recording each change', async () => {
    const { work, project } = await setup();
    const manual = work.createTask(project.id, { kind: 'manual', storyId: null, title: 'Key', description: '' });

    expect(work.complete(manual.id).status).toBe('done');
    expect(work.reopen(manual.id, 'wrong key').status).toBe('todo');
    expect(work.cancel(manual.id).status).toBe('cancelled');

    const history = work.details(manual.id).history.map((h) => [h.type, (h.data as { to?: string }).to]);
    expect(history).toEqual([
      [workEvents.taskCreated, undefined],
      [workEvents.taskStatusChanged, 'done'],
      [workEvents.taskStatusChanged, 'todo'],
      [workEvents.taskStatusChanged, 'cancelled'],
    ]);
    expect(work.details(manual.id).task.statusReason).toBeNull();
  });

  it('refuses transitions the state machine does not allow', async () => {
    const { work, project, SYSTEM } = await setup();
    const task = work.createTask(project.id, { kind: 'task', storyId: null, title: 't', description: '' });

    expect(() => work.complete(task.id)).toThrow(expect.objectContaining({ code: 'NOT_A_MANUAL_TASK' }));
    expect(() => work.transition(task.id, 'running', null, SYSTEM)).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
    work.cancel(task.id, 'not needed');
    expect(() => work.cancel(task.id)).toThrow(expect.objectContaining({ code: 'INVALID_TRANSITION' }));
    expect(work.details(task.id).task.statusReason).toBe('not needed');
  });

  it('walks a task through the whole lifecycle', async () => {
    const { work, project, SYSTEM } = await setup();
    const { id } = work.createTask(project.id, { kind: 'task', storyId: null, title: 't', description: '' });
    for (const to of ['blocked', 'ready', 'running', 'needs_you', 'running', 'failed', 'ready', 'running', 'merging', 'done']) {
      expect(work.transition(id, to, null, SYSTEM).status).toBe(to);
    }
  });

  it('refuses a forbidden transition even when appended directly to the log', async () => {
    const { work, store, project } = await setup();
    const task = work.createTask(project.id, { kind: 'task', storyId: null, title: 't', description: '' });
    expect(() =>
      store.append([
        {
          type: workEvents.taskStatusChanged,
          stream: taskStream(task.id),
          data: { id: task.id, from: 'backlog', to: 'done', reason: null },
          actor: { kind: 'system' },
        },
      ]),
    ).toThrow('Invalid transition');
    expect(work.details(task.id).task.status).toBe('backlog');
  });

  it('updates titles and moves a task between stories', async () => {
    const { work, project } = await setup();
    const a = work.createStory(project.id, { title: 'A', description: '' });
    const b = work.createStory(project.id, { title: 'B', description: '' });
    const task = work.createTask(project.id, { kind: 'task', storyId: a.id, title: 'old', description: 'd' });

    const moved = work.updateTask(task.id, { title: 'new', storyId: b.id });
    expect(moved).toMatchObject({ title: 'new', description: 'd', storyId: b.id });
    expect(work.updateTask(task.id, { storyId: null }).storyId).toBeNull();
    expect(work.updateStory(a.id, { description: 'why' })).toMatchObject({ title: 'A', description: 'why' });
  });

  it('rebuilds stories, tasks and statuses from the log', async () => {
    const { work, store, project, SYSTEM } = await setup();
    const story = work.createStory(project.id, { title: 'S', description: '' });
    const t1 = work.createTask(project.id, { kind: 'task', storyId: story.id, title: 't1', description: '' });
    const m1 = work.createTask(project.id, { kind: 'manual', storyId: story.id, title: 'm1', description: '' });
    work.transition(t1.id, 'ready', null, SYSTEM);
    work.complete(m1.id);
    work.updateTask(t1.id, { title: 't1!' });
    const before = work.work(project.id);

    store.rebuild();

    expect(work.work(project.id)).toEqual(before);
    expect(before.stories[0]?.status).toBe('ready');
  });
});
