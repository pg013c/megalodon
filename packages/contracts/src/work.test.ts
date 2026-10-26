import { describe, expect, it } from 'vitest';
import {
  canTransition,
  deriveStoryStatus,
  manualTransitions,
  taskStatusSchema,
  taskTransitions,
  type StatusOf,
} from './work';

const t = (status: string): StatusOf => ({ kind: 'task', status });
const m = (status: string): StatusOf => ({ kind: 'manual', status });

describe('transition tables', () => {
  it('cover every status, and only lead to known statuses', () => {
    const statuses = taskStatusSchema.options;
    expect(Object.keys(taskTransitions).sort()).toEqual([...statuses].sort());
    for (const targets of Object.values(taskTransitions)) for (const to of targets) expect(statuses).toContain(to);
    for (const targets of Object.values(manualTransitions)) for (const to of targets) expect(Object.keys(manualTransitions)).toContain(to);
  });

  it('keep terminal statuses terminal, except retrying a failed task', () => {
    expect(taskTransitions.done).toEqual([]);
    expect(taskTransitions.cancelled).toEqual([]);
    expect(taskTransitions.failed).toEqual(['ready']);
    expect(manualTransitions.verified).toEqual([]);
  });

  it('check transitions by kind', () => {
    expect(canTransition('task', 'backlog', 'ready')).toBe(true);
    expect(canTransition('task', 'backlog', 'running')).toBe(false);
    expect(canTransition('task', 'merging', 'cancelled')).toBe(false);
    expect(canTransition('manual', 'todo', 'done')).toBe(true);
    expect(canTransition('manual', 'backlog', 'ready')).toBe(false);
    expect(canTransition('task', 'nope', 'ready')).toBe(false);
  });
});

describe('deriveStoryStatus', () => {
  it('is backlog for a story without tasks', () => {
    expect(deriveStoryStatus([])).toBe('backlog');
  });

  it('1. cancelled when every task is cancelled', () => {
    expect(deriveStoryStatus([t('cancelled'), m('cancelled')])).toBe('cancelled');
  });

  it('2. done when every non-cancelled task is done or verified', () => {
    expect(deriveStoryStatus([t('done'), m('verified'), m('done'), t('cancelled')])).toBe('done');
  });

  it('3. needs_you when a task needs you, failed, or a manual task waits', () => {
    expect(deriveStoryStatus([t('needs_you'), t('running')])).toBe('needs_you');
    expect(deriveStoryStatus([t('failed'), t('ready')])).toBe('needs_you');
    expect(deriveStoryStatus([m('todo'), t('running')])).toBe('needs_you');
  });

  it('4. running when a task runs or merges', () => {
    expect(deriveStoryStatus([t('running'), t('ready')])).toBe('running');
    expect(deriveStoryStatus([t('merging'), t('blocked')])).toBe('running');
  });

  it('5. ready when a task is ready', () => {
    expect(deriveStoryStatus([t('ready'), t('blocked'), t('done')])).toBe('ready');
  });

  it('6. blocked when nothing can start', () => {
    expect(deriveStoryStatus([t('blocked'), t('backlog')])).toBe('blocked');
  });

  it('7. backlog otherwise', () => {
    expect(deriveStoryStatus([t('backlog'), t('done')])).toBe('backlog');
  });
});
