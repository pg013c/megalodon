import type { Story, Task } from '@megalodon/contracts';

/** The tasks of one story, in number order. */
export function storyTasks(tasks: Task[], storyId: string): Task[] {
  return tasks.filter((t) => t.storyId === storyId).sort((a, b) => a.number - b.number);
}

/**
 * The share of a story's tasks that are done, 0..1. It uses the server's `doneCount` (done or
 * verified tasks, see apps/server/src/work/projection.ts); the story status itself is derived per
 * CONCEPTS.md §3 "Story (derived)".
 */
export function storyProgress(story: Pick<Story, 'doneCount' | 'taskCount'>): number {
  if (story.taskCount === 0) return 0;
  return Math.min(1, Math.max(0, story.doneCount / story.taskCount));
}
