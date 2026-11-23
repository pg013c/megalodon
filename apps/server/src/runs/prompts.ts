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

/** For a step guarded by the project's test paths (ADR-0034). */
export function testStepInstructions(mode: 'only' | 'locked', globs: readonly string[]): string {
  const list = globs.map((g) => `- \`${g}\``).join('\n');
  return mode === 'only'
    ? [
        'This step writes the tests only. Unlike your usual instructions, do not implement the change and do not make the tests pass; a later step does.',
        "Write tests for the plan that fail against the current code, for the reason the planned change will fix. Change only files matching the project's test paths:",
        list,
        'Megalodon runs the tests after this step and expects them to fail.',
      ].join('\n')
    : [
        'The tests for this task are written and locked: do not change, add or delete any file matching:',
        list,
        'Change the code until they pass. If a test looks wrong, say so in your summary instead of changing it.',
      ].join('\n');
}

/** The commit type a step must use under Conventional Commits. */
export function commitTypeInstructions(types: readonly string[]): string {
  const list = types.map((t) => `\`${t}\``);
  return types.length === 1 ? `The type of this commit is ${list[0]}.` : `The type of this commit is one of ${list.join(', ')}.`;
}

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
