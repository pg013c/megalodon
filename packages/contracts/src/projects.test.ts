import { describe, expect, it } from 'vitest';
import { knowledgeSchema, projectSettingsSchema, type ProjectSettings } from './projects';

const settings: ProjectSettings = {
  baseBranch: 'main',
  packageManager: 'pnpm',
  setup: ['pnpm install --frozen-lockfile'],
  checks: [{ name: 'test', command: 'pnpm test', required: true, timeoutSec: 900 }],
  maxFixPasses: 2,
  sensitivePaths: [],
  knowledge: { location: 'repo', path: 'docs' },
  maxParallel: null,
};

describe('projectSettingsSchema', () => {
  it('accepts valid settings', () => {
    expect(projectSettingsSchema.parse(settings)).toEqual(settings);
  });

  it('rejects duplicate check names', () => {
    const result = projectSettingsSchema.safeParse({ ...settings, checks: [...settings.checks, ...settings.checks] });
    expect(result.success).toBe(false);
  });

  it('keeps the knowledge base inside the project', () => {
    expect(knowledgeSchema.safeParse({ location: 'repo', path: '../elsewhere' }).success).toBe(false);
    expect(knowledgeSchema.safeParse({ location: 'repo', path: '/abs' }).success).toBe(false);
    expect(knowledgeSchema.safeParse({ location: 'repo', path: 'docs/kb' }).success).toBe(true);
  });
});
