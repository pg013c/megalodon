import type { Task } from '@megalodon/contracts';

/** Board columns are the task statuses (CONCEPTS.md §3); manual tasks land in the matching one. */
export const columns = ['backlog', 'blocked', 'ready', 'running', 'needs_you', 'merging', 'done', 'failed', 'cancelled'] as const;
export type Column = (typeof columns)[number];

/** Shown even when empty; the rest appear only when they hold something (cancelled: on request). */
export const coreColumns: readonly Column[] = ['backlog', 'blocked', 'ready', 'running', 'needs_you', 'merging', 'done'];

export function columnOf(task: Pick<Task, 'kind' | 'status'>): Column {
  if (task.kind === 'manual') {
    if (task.status === 'todo') return 'needs_you';
    if (task.status === 'cancelled') return 'cancelled';
    return 'done';
  }
  return task.status as Column;
}

export const statusLabel: Record<string, string> = {
  backlog: 'Backlog',
  blocked: 'Blocked',
  ready: 'Ready',
  running: 'Running',
  needs_you: 'Needs you',
  merging: 'Merging',
  done: 'Done',
  failed: 'Failed',
  cancelled: 'Cancelled',
  todo: 'To do',
  verified: 'Verified',
};

export const statusDot: Record<string, string> = {
  backlog: 'bg-muted/50',
  blocked: 'bg-[#ff9f0a]',
  ready: 'bg-accent',
  running: 'bg-[#5e5ce6]',
  needs_you: 'bg-[#ff375f]',
  merging: 'bg-[#64d2ff]',
  done: 'bg-[#30d158]',
  verified: 'bg-[#30d158]',
  failed: 'bg-[#ff3b30]',
  cancelled: 'bg-line',
  todo: 'bg-[#ff375f]',
};
