import type { Check, CommitSettings, Policies, ProjectSettings } from '@megalodon/contracts';
import { linesToList, listToLines } from '../../lib/format';

/** The settings as the form edits them: lists as multi-line text, numbers as strings. */
export interface SettingsForm {
  baseBranch: string;
  setup: string;
  checks: { name: string; command: string; required: boolean; timeoutSec: string }[];
  maxFixPasses: string;
  sensitivePaths: string;
  knowledgeLocation: 'repo' | 'external';
  knowledgePath: string;
  /** Empty: no per-project limit. */
  maxParallel: string;
  policies: Policies;
  /** Trailers as multi-line text. */
  commits: { style: CommitSettings['style']; trailers: string; hooks: boolean };
  testPaths: string;
}

export function toForm(s: ProjectSettings): SettingsForm {
  return {
    baseBranch: s.baseBranch,
    setup: listToLines(s.setup),
    checks: s.checks.map((c) => ({ ...c, timeoutSec: String(c.timeoutSec) })),
    maxFixPasses: String(s.maxFixPasses),
    sensitivePaths: listToLines(s.sensitivePaths),
    knowledgeLocation: s.knowledge.location,
    knowledgePath: s.knowledge.path,
    maxParallel: s.maxParallel === null ? '' : String(s.maxParallel),
    policies: s.policies,
    commits: { style: s.commits.style, trailers: listToLines(s.commits.trailers), hooks: s.commits.hooks },
    testPaths: listToLines(s.testPaths),
  };
}

/** Back to settings; the server validates the result against the contract. */
export function fromForm(form: SettingsForm, packageManager: ProjectSettings['packageManager']): ProjectSettings {
  return {
    baseBranch: form.baseBranch.trim(),
    packageManager,
    setup: linesToList(form.setup),
    checks: form.checks
      .filter((c) => c.name.trim() || c.command.trim())
      .map((c): Check => ({ name: c.name.trim(), command: c.command.trim(), required: c.required, timeoutSec: Number(c.timeoutSec) })),
    maxFixPasses: Number(form.maxFixPasses),
    sensitivePaths: linesToList(form.sensitivePaths),
    knowledge: { location: form.knowledgeLocation, path: form.knowledgePath.trim() },
    maxParallel: form.maxParallel.trim() === '' ? null : Number(form.maxParallel),
    policies: form.policies,
    commits: { style: form.commits.style, trailers: linesToList(form.commits.trailers), hooks: form.commits.hooks },
    testPaths: linesToList(form.testPaths),
  };
}
