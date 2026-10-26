import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitAll, initRepo, sh } from '../test/repo';
import { useTempDir } from '../test/tempDir';
import { currentBranch, dirtyFiles, globToRegExp, merge, predictConflicts, unmergedFiles } from './git';

const tempDir = useTempDir();

describe('merge git helpers', () => {
  it('predicts conflicts without touching the work tree', async () => {
    const root = initRepo(join(tempDir(), 'r'), { 'a.txt': 'one\n', 'b.txt': 'b\n' });
    sh(root, 'checkout', '-q', '-b', 'feature');
    writeFileSync(join(root, 'a.txt'), 'feature\n');
    commitAll(root, 'feature');
    sh(root, 'checkout', '-q', 'main');
    writeFileSync(join(root, 'a.txt'), 'main\n');
    commitAll(root, 'main');

    expect(await predictConflicts(root, 'main', 'feature')).toEqual(['a.txt']);
    expect(sh(root, 'status', '--porcelain')).toBe('');
    expect(await merge(root, 'feature', 'merge')).toEqual(['a.txt']);
    expect(await unmergedFiles(root)).toEqual(['a.txt']);
  });

  it('reports the branch and the dirty tracked files of a checkout', async () => {
    const root = initRepo(join(tempDir(), 'r'), { 'a.txt': 'a\n' });
    expect(await currentBranch(root)).toBe('main');
    writeFileSync(join(root, 'a.txt'), 'changed\n');
    writeFileSync(join(root, 'new.txt'), 'untracked\n');
    expect(await dirtyFiles(root)).toEqual(['a.txt']);
  });

  it('matches sensitive-path globs', () => {
    expect(globToRegExp('src/payments/**').test('src/payments/stripe/client.ts')).toBe(true);
    expect(globToRegExp('src/payments').test('src/payments/a.ts')).toBe(true);
    expect(globToRegExp('migrations/*.sql').test('migrations/001.sql')).toBe(true);
    expect(globToRegExp('migrations/*.sql').test('migrations/x/001.sql')).toBe(false);
    expect(globToRegExp('src/auth/**').test('src/authors.ts')).toBe(false);
  });
});
