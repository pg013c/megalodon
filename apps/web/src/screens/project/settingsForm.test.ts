import { defaultCommits, defaultPolicies, type ProjectSettings } from '@megalodon/contracts';
import { describe, expect, it } from 'vitest';
import { fromForm, toForm } from './settingsForm';

const settings: ProjectSettings = {
  baseBranch: 'main',
  packageManager: 'pnpm',
  setup: ['pnpm install --frozen-lockfile'],
  checks: [{ name: 'test', command: 'pnpm run test', required: true, timeoutSec: 900 }],
  maxFixPasses: 2,
  sensitivePaths: ['src/payments/**', 'migrations/**'],
  knowledge: { location: 'repo', path: 'docs' },
  maxParallel: null,
  policies: defaultPolicies,
  commits: defaultCommits,
};

describe('settings form', () => {
  it('round-trips settings', () => {
    expect(fromForm(toForm(settings), 'pnpm')).toEqual(settings);
  });

  it('drops empty check rows and blank lines', () => {
    const form = toForm(settings);
    form.checks.push({ name: ' ', command: '', required: false, timeoutSec: '60' });
    form.sensitivePaths = 'src/auth/**\n\n';
    const result = fromForm(form, 'pnpm');
    expect(result.checks).toHaveLength(1);
    expect(result.sensitivePaths).toEqual(['src/auth/**']);
  });

  it('round-trips commit conventions, trailers one per line', () => {
    const form = toForm({ ...settings, commits: { style: 'conventional', trailers: ['Refs: #1'], hooks: true } });
    expect(form.commits).toEqual({ style: 'conventional', trailers: 'Refs: #1', hooks: true });
    form.commits.trailers = 'Refs: #1\n\n  Signed-off-by: A <a@x>  \n';
    expect(fromForm(form, 'pnpm').commits).toEqual({ style: 'conventional', trailers: ['Refs: #1', 'Signed-off-by: A <a@x>'], hooks: true });
  });
});
