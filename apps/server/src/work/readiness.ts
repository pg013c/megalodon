import { deriveStoryStatus, type Dependency, type Requirement, type Task } from '@megalodon/contracts';
import type { WorkQueries } from './projection';

const MERGED = new Set(['done']);
const MANUAL_DONE = new Set(['done', 'verified']);

/** What a task needs to start, from its dependencies (CONCEPTS.md §4). Collisions are added by the scheduler. */
export function requirementsOf(task: Task, queries: WorkQueries): Requirement[] {
  return queries.dependencies(task.id).map((dependency) => requirement(dependency, queries));
}

function requirement(dependency: Dependency, queries: WorkQueries): Requirement {
  const base = { kind: dependency.kind, dependencyId: dependency.id };
  if (dependency.kind === 'external') return { ...base, label: dependency.description, met: dependency.met, ref: null };
  const target = dependency.target!;
  if (target.type === 'story') {
    const story = queries.story(target.id);
    if (!story) return { ...base, label: 'A deleted story', met: true, ref: null };
    const tasks = queries.storyTasks(story.id);
    return {
      ...base,
      label: `#${story.number} ${story.title}`,
      // a story is met when every task of it is merged (CONCEPTS.md §4)
      met: tasks.length > 0 && deriveStoryStatus(tasks) === 'done',
      ref: { type: 'story', id: story.id, number: story.number },
    };
  }
  const other = queries.task(target.id);
  if (!other) return { ...base, label: 'A deleted task', met: true, ref: null };
  const met = dependency.kind === 'manual' ? MANUAL_DONE.has(other.status) : MERGED.has(other.status);
  return { ...base, label: `#${other.number} ${other.title}`, met, ref: { type: 'task', id: other.id, number: other.number } };
}

/**
 * The directory prefix a touch-set entry covers: `src/payments/**` → `src/payments`. An entry that
 * starts with a glob covers the whole repository ('').
 */
export function touchPrefix(path: string): string {
  const segments = path.replace(/^\.\//, '').replace(/\/+$/, '').split('/');
  const fixed: string[] = [];
  for (const segment of segments) {
    if (/[*?[{]/.test(segment)) break;
    fixed.push(segment);
  }
  return fixed.join('/');
}

/** Two touch-sets collide when one entry lies inside or over the other (CONCEPTS.md §4). */
export function touchesOverlap(a: readonly string[], b: readonly string[]): boolean {
  for (const x of a.map(touchPrefix)) {
    for (const y of b.map(touchPrefix)) {
      if (x === '' || y === '' || x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`)) return true;
    }
  }
  return false;
}
