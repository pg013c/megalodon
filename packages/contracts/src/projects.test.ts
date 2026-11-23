import { describe, expect, it } from 'vitest';
import { commitsSchema, defaultCommits, defaultPolicies, knowledgeSchema, projectSettingsSchema, type ProjectSettings } from './projects';

const settings: ProjectSettings = {
  baseBranch: 'main',
  packageManager: 'pnpm',
  setup: ['pnpm install --frozen-lockfile'],
  checks: [{ name: 'test', command: 'pnpm test', required: true, timeoutSec: 900 }],
  maxFixPasses: 2,
  sensitivePaths: [],
  knowledge: { location: 'repo', path: 'docs' },
  maxParallel: null,
  policies: defaultPolicies,
  commits: defaultCommits,
  testPaths: ['**/tests/**'],
};

describe('projectSettingsSchema', () => {
  it('accepts valid settings', () => {
    expect(projectSettingsSchema.parse(settings)).toEqual(settings);
  });

  it('rejects duplicate check names', () => {
    const result = projectSettingsSchema.safeParse({ ...settings, checks: [...settings.checks, ...settings.checks] });
    expect(result.success).toBe(false);
  });

  it('fills policies for settings stored before they existed', () => {
    const { policies: _, ...older } = settings;
    expect(projectSettingsSchema.parse(older).policies).toEqual({
      queue: { mode: 'auto' },
      plan: { mode: 'auto' },
      merge: { mode: 'auto_if', minScore: 7 },
      conflicts: { mode: 'auto', attempts: 2 },
      push: { mode: 'operator', remote: 'origin' },
    });
  });

  it('keeps Megalodon commits for settings stored before commit conventions existed', () => {
    const { commits: _, ...older } = settings;
    expect(projectSettingsSchema.parse(older).commits).toEqual({ style: 'megalodon', trailers: [], hooks: false });
  });

  it('has no test paths for settings stored before the test-first pipeline existed', () => {
    const { testPaths: _, ...older } = settings;
    expect(projectSettingsSchema.parse(older).testPaths).toEqual([]);
  });

  it('accepts trailers as `Token: value` only', () => {
    expect(commitsSchema.safeParse({ style: 'conventional', trailers: ['Signed-off-by: A <a@x>', ' Refs: #1 '], hooks: true }).success).toBe(true);
    expect(commitsSchema.safeParse({ style: 'conventional', trailers: ['no colon'], hooks: false }).success).toBe(false);
    expect(commitsSchema.safeParse({ style: 'conventional', trailers: ['Refs:#1'], hooks: false }).success).toBe(false);
  });

  it('keeps the knowledge base inside the project', () => {
    expect(knowledgeSchema.safeParse({ location: 'repo', path: '../elsewhere' }).success).toBe(false);
    expect(knowledgeSchema.safeParse({ location: 'repo', path: '/abs' }).success).toBe(false);
    expect(knowledgeSchema.safeParse({ location: 'repo', path: 'docs/kb' }).success).toBe(true);
  });
});
