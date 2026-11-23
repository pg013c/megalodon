import { TRAILER, type CommitOutput, type CommitSettings, type PlannedStep, type Task } from '@megalodon/contracts';

/**
 * The messages of the commits Megalodon writes on task branches, per the project's commit
 * conventions (ADR-0033).
 */

/** The types of @commitlint/config-conventional. */
const CONVENTIONAL_SUBJECT = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^()\r\n]+\))?!?: \S[^\r\n]*$/;
const MAX_SUBJECT = 100;

export function isConventionalSubject(subject: string): boolean {
  return subject.length <= MAX_SUBJECT && CONVENTIONAL_SUBJECT.test(subject);
}

/** The message of the commit after an agent step. */
export function runCommitMessage(
  settings: CommitSettings,
  task: Pick<Task, 'number' | 'title'>,
  step: Pick<Extract<PlannedStep, { kind: 'agent' }>, 'name'>,
  attempt: number,
  reply: string,
  output: CommitOutput['commit'] | null,
): string {
  const own = settings.style === 'conventional' ? (output?.trailers ?? []).map((t) => t.trim()).filter((t) => TRAILER.test(t)) : [];
  const trailers = [...new Set([...own, ...settings.trailers])];
  let subject: string;
  let body: string;
  if (settings.style === 'megalodon') {
    subject = attempt === 1 ? `#${task.number} ${task.title}` : `#${task.number} ${step.name}: fixes (attempt ${attempt})`;
    body = reply.trim().slice(0, 4_000);
  } else {
    // the agent's chat reply never becomes the body: it is not a commit message
    const given = output?.subject.trim() ?? '';
    subject = isConventionalSubject(given) ? given : `chore: #${task.number} ${task.title}`.slice(0, MAX_SUBJECT).trimEnd();
    body = output?.body.trim() ?? '';
  }
  return [subject, body, trailers.join('\n')].filter(Boolean).join('\n\n');
}

/** The subject of a merge commit: `Merge #N <title>`, or `merge: #N <title>` under Conventional Commits. */
export function mergeSubject(style: CommitSettings['style'], text: string): string {
  return style === 'conventional' ? `merge: ${text}` : `Merge ${text}`;
}
