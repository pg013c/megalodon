import type { PlanOutput, Project, ReviewOutput, Task } from '@megalodon/contracts';

export function taskPrompt(task: Task, project: Project, branch: string): string {
  const checks = project.settings.checks.map((c) => `- ${c.name}: \`${c.command}\``).join('\n');
  return [
    `Task #${task.number} in ${project.name}: ${task.title}`,
    '',
    task.description.trim() || '(No description beyond the title.)',
    '',
    `You are in a git worktree on the branch \`${branch}\`, created from \`${project.settings.baseBranch}\`.`,
    checks ? `The project's checks:\n${checks}` : 'The project has no configured checks.',
  ].join('\n');
}

export function planText(plan: PlanOutput): string {
  const list = (items: string[]) => items.map((i) => `- ${i}`).join('\n') || '- (none)';
  return [
    `Summary: ${plan.summary}`,
    '',
    'Steps:',
    plan.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    '',
    'Touches:',
    list(plan.touches),
    '',
    'Risks:',
    list(plan.risks),
  ].join('\n');
}

export function reviewFeedback(review: ReviewOutput): string {
  const findings = review.findings.map((f) => `- [${f.severity}]${f.file ? ` ${f.file}:` : ''} ${f.message}`).join('\n');
  return `The reviewer asked for changes (score ${review.score}/10): ${review.summary}\n${findings}`;
}

export const planningPrompt = (base: string) => `${base}\n\nRead the code and write the implementation plan.`;

export function implementationPrompt(base: string, plan: PlanOutput | null): string {
  return plan ? `${base}\n\nThe agreed plan:\n${planText(plan)}\n\nImplement it.` : `${base}\n\nImplement the task.`;
}

export const fixPrompt = (feedback: string) =>
  `Your change is not done yet.\n\n${feedback}\n\nFix the code so this is resolved, then finish with a short summary of what you changed.`;

/** For projects that follow Conventional Commits (ADR-0033): the agent writes the message, Megalodon commits. */
export const commitInstructions = [
  'This project follows Conventional Commits. Do not commit yourself: Megalodon commits your work when you finish.',
  'Put the commit message in your structured answer:',
  '- subject: `type(scope): summary`, one line of at most 100 characters; type is one of feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert; the scope is optional.',
  '- body: what changed and why, wrapped at 72 columns; may be empty.',
  '- trailers: git trailers as `Token: value`, only if the change needs them; may be empty.',
].join('\n');

export function reviewPrompt(base: string, plan: PlanOutput | null, diff: string, checks: string | null): string {
  return [
    base,
    '',
    plan ? `The agreed plan:\n${planText(plan)}` : 'There was no separate plan.',
    '',
    checks ? `Check results:\n${checks}` : 'No checks ran.',
    '',
    `The change (\`git diff\` against the base):\n\`\`\`diff\n${diff}\n\`\`\``,
    '',
    'Review the change.',
  ].join('\n');
}

export const resumePrompt =
  'Megalodon was restarted while you were working on this task. Check the state of the working directory, continue from where you stopped and finish the task.';
