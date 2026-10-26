import type { Task } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { storyProgress, storyTasks } from './stories';

const task = (number: number, storyId: string | null): Task => ({
  id: `t${number}`,
  projectId: 'p',
  number,
  kind: 'task',
  storyId,
  title: `Task ${number}`,
  description: '',
  status: 'backlog',
  statusReason: null,
  statusChangedAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  touches: [],
  pipelineId: 'full',
  front: false,
  triage: 'none',
  triageSummary: null,
});

describe('storyTasks', () => {
  it("keeps only the story's tasks, in number order", () => {
    const tasks = [task(5, 's1'), task(2, 's2'), task(3, 's1'), task(4, null)];
    expect(storyTasks(tasks, 's1').map((t) => t.number)).toEqual([3, 5]);
  });
});

describe('storyProgress', () => {
  it('is the share of done tasks', () => {
    expect(storyProgress({ doneCount: 0, taskCount: 0 })).toBe(0);
    expect(storyProgress({ doneCount: 1, taskCount: 2 })).toBe(0.5);
    expect(storyProgress({ doneCount: 3, taskCount: 3 })).toBe(1);
  });
});
