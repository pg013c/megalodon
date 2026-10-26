import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Check, PackageManager, ProjectSettings } from '@megalodon/contracts';

/** Scripts that become checks when the project defines them, in this order. */
const CHECK_SCRIPTS = ['typecheck', 'lint', 'test'] as const;

/** Sensible settings for a freshly connected project, for the operator to confirm (ADR-0015). */
export function detectSettings(root: string, baseBranch: string): ProjectSettings {
  const packageManager = detectPackageManager(root);
  const scripts = readScripts(root);
  const checks: Check[] = packageManager
    ? CHECK_SCRIPTS.filter((name) => name in scripts).map((name) => ({
        name,
        command: `${packageManager} run ${name}`,
        required: true,
        timeoutSec: 900,
      }))
    : [];

  return {
    baseBranch,
    packageManager,
    setup: packageManager ? [installCommand(root, packageManager)] : [],
    checks,
    maxFixPasses: 2,
    sensitivePaths: [],
    knowledge: { location: 'repo', path: 'docs' },
  };
}

function detectPackageManager(root: string): PackageManager | null {
  const has = (file: string) => existsSync(join(root, file));
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lock') || has('bun.lockb')) return 'bun';
  if (has('package-lock.json') || has('package.json')) return 'npm';
  return null;
}

function installCommand(root: string, pm: PackageManager): string {
  switch (pm) {
    case 'pnpm':
      return 'pnpm install --frozen-lockfile';
    case 'yarn':
      // Yarn 2+ (configured by .yarnrc.yml) renamed the flag
      return existsSync(join(root, '.yarnrc.yml')) ? 'yarn install --immutable' : 'yarn install --frozen-lockfile';
    case 'bun':
      return 'bun install --frozen-lockfile';
    case 'npm':
      return existsSync(join(root, 'package-lock.json')) ? 'npm ci' : 'npm install';
  }
}

function readScripts(root: string): Record<string, string> {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: Record<string, string> };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}
