import { TRAILER, conventionalTypes, type CommitOutput, type CommitSettings, type PlannedStep, type Task } from '@megalodon/contracts';

/**
 * The messages of the commits Megalodon writes on task branches, per the project's commit
 * conventions (ADR-0035).
 */

const CONVENTIONAL_SUBJECT = new RegExp(`^(${conventionalTypes.join('|')})(\\([^()\\r\\n]+\\))?!?: \\S[^\\r\\n]*$`);
const MAX_SUBJECT = 100;

export function isConventionalSubject(subject: string): boolean {
  return subject.length <= MAX_SUBJECT && CONVENTIONAL_SUBJECT.test(subject);
}

/**
 * The message of the commit after an agent step. Under Conventional Commits, a step with
 * `commitTypes` gets one of them: another type is replaced by the first (ADR-0034).
 */
export function runCommitMessage(
  settings: CommitSettings,
  task: Pick<Task, 'number' | 'title'>,
  step: Pick<Extract<PlannedStep, { kind: 'agent' }>, 'name'> & { commitTypes?: readonly string[] | null },
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
    const types = step.commitTypes?.length ? step.commitTypes : null;
    const type = given.match(CONVENTIONAL_SUBJECT)?.[1];
    if (isConventionalSubject(given)) subject = types && !types.includes(type!) ? `${types[0]}${given.slice(type!.length)}` : given;
    else subject = `${types?.[0] ?? 'chore'}: #${task.number} ${task.title}`;
    subject = subject.slice(0, MAX_SUBJECT).trimEnd();
    body = output?.body.trim() ?? '';
  }
  return [subject, body, trailers.join('\n')].filter(Boolean).join('\n\n');
}

/** The subject of a merge commit: `Merge #N <title>`, or `merge: #N <title>` under Conventional Commits. */
export function mergeSubject(style: CommitSettings['style'], text: string): string {
  return style === 'conventional' ? `merge: ${text}` : `Merge ${text}`;
}
