import { defaultCommits, type CommitSettings } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { isConventionalSubject, mergeSubject, runCommitMessage } from './commits';

const task = { number: 7, title: 'Add checkout' };
const step = { name: 'Implementer' };
const conventional: CommitSettings = { style: 'conventional', trailers: [], hooks: false };
const reply = 'Implementer finished.';

describe('runCommitMessage: Megalodon style', () => {
  it('keeps the subject and the chat reply as the body, as before commit conventions', () => {
    expect(runCommitMessage(defaultCommits, task, step, 1, `  ${reply}\n`, null)).toBe(`#7 Add checkout\n\n${reply}`);
    expect(runCommitMessage(defaultCommits, task, step, 3, reply, null)).toBe(`#7 Implementer: fixes (attempt 3)\n\n${reply}`);
    expect(runCommitMessage(defaultCommits, task, step, 1, '', null)).toBe('#7 Add checkout');
  });

  it('appends the configured trailers', () => {
    const settings: CommitSettings = { ...defaultCommits, trailers: ['Refs: #7'] };
    expect(runCommitMessage(settings, task, step, 1, reply, null)).toBe(`#7 Add checkout\n\n${reply}\n\nRefs: #7`);
  });

  it('ignores a commit message the agent may have given', () => {
    const output = { subject: 'feat: add checkout', body: 'Body.', trailers: ['X-Agent: yes'] };
    expect(runCommitMessage(defaultCommits, task, step, 1, reply, output)).toBe(`#7 Add checkout\n\n${reply}`);
  });
});

describe('runCommitMessage: Conventional Commits', () => {
  it("uses the agent's message, its trailers, then the configured ones", () => {
    const settings: CommitSettings = { ...conventional, trailers: ['Refs: #7'] };
    const output = { subject: ' feat(checkout): add the checkout page ', body: 'Adds the page.\n', trailers: ['Co-authored-by: A <a@x>'] };
    expect(runCommitMessage(settings, task, step, 1, reply, output)).toBe(
      'feat(checkout): add the checkout page\n\nAdds the page.\n\nCo-authored-by: A <a@x>\nRefs: #7',
    );
  });

  it.each(['Add stuff', 'feat:no-space', 'feat: one\ntwo', `feat: ${'x'.repeat(100)}`, 'feature: add', ''])('falls back on the subject %j', (subject) => {
    expect(runCommitMessage(conventional, task, step, 1, reply, { subject, body: '', trailers: [] })).toBe('chore: #7 Add checkout');
  });

  it('falls back without a body and never uses the chat reply', () => {
    const message = runCommitMessage({ ...conventional, trailers: ['Refs: #7'] }, task, step, 2, reply, null);
    expect(message).toBe('chore: #7 Add checkout\n\nRefs: #7');
    expect(message).not.toContain(reply);
  });

  it('clips a long fallback subject to 100 characters', () => {
    const subject = runCommitMessage(conventional, { number: 7, title: 'x'.repeat(200) }, step, 1, reply, null);
    expect(subject).toHaveLength(100);
    expect(subject.startsWith('chore: #7 x')).toBe(true);
  });

  it('drops malformed and duplicate trailers', () => {
    const output = { subject: 'fix: x', body: '', trailers: ['not a trailer', 'Refs: #7', 'Refs: #7', 'Signed-off-by: A <a@x>'] };
    expect(runCommitMessage({ ...conventional, trailers: ['Refs: #7'] }, task, step, 1, reply, output)).toBe('fix: x\n\nRefs: #7\nSigned-off-by: A <a@x>');
  });
});

describe('isConventionalSubject', () => {
  it('accepts the conventional types, a scope and a breaking mark', () => {
    for (const s of ['feat: a', 'fix(api): b', 'refactor!: c', 'chore(deps)!: d', 'revert: e']) expect(isConventionalSubject(s)).toBe(true);
    for (const s of ['merge: a', 'feat(): a', 'feat(a)(b): c', 'Feat: a', 'feat:  ']) expect(isConventionalSubject(s)).toBe(false);
  });
});

describe('mergeSubject', () => {
  it('follows the style', () => {
    expect(mergeSubject('megalodon', '#7 Add checkout')).toBe('Merge #7 Add checkout');
    expect(mergeSubject('conventional', 'main into megalodon/7-add-checkout')).toBe('merge: main into megalodon/7-add-checkout');
  });
});
