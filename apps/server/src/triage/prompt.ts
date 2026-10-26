import type { Pipeline, Project, Story, Task } from '@megalodon/contracts';

const OPEN = new Set(['backlog', 'blocked', 'ready', 'running', 'needs_you', 'merging', 'failed', 'todo']);

/** The task, the rest of the open work and the pipelines to choose from. */
export function triagePrompt(task: Task, project: Project, tasks: Task[], stories: Story[], pipelines: Pipeline[]): string {
  const others = tasks
    .filter((t) => t.id !== task.id && OPEN.has(t.status))
    .map((t) => `- #${t.number} [${t.kind === 'manual' ? 'manual, ' : ''}${t.status}] ${t.title}${t.touches.length ? ` — touches ${t.touches.join(', ')}` : ''}`);
  const openStories = stories.filter((s) => s.status !== 'done' && s.status !== 'cancelled').map((s) => `- #${s.number} [story, ${s.status}] ${s.title}`);
  const story = task.storyId ? stories.find((s) => s.id === task.storyId) : null;
  return [
    `New task #${task.number} in ${project.name}: ${task.title}`,
    story ? `Part of story #${story.number} ${story.title}.` : '',
    '',
    task.description.trim() || '(No description beyond the title.)',
    '',
    `The working directory is the project's \`${project.settings.baseBranch}\` branch, read-only.`,
    '',
    'Other open work in this project:',
    [...openStories, ...others].join('\n') || '- (none)',
    '',
    'Pipelines:',
    pipelines.map((p) => `- ${p.id}: ${p.name}. ${p.description}`).join('\n'),
    '',
    'Triage the task.',
  ]
    .filter((line, i, lines) => line !== '' || lines[i - 1] !== '')
    .join('\n');
}
