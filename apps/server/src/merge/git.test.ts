import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { commitAll, initRepo, sh, write } from '../test/repo';
import { useTempDir } from '../test/tempDir';
import { addedFiles, currentBranch, dirtyFiles, globToRegExp, merge, predictConflicts, treeFiles, unmergedFiles } from './git';

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

  it('lists added files with renames as additions, and paths as they are', async () => {
    const root = initRepo(join(tempDir(), 'r'), { 'docs/adr/0001-a.md': '# ADR-0001: A\n\nThe first decision.\n', 'docs/adr/0002-b.md': '# ADR-0002: B\n\nThe second decision, long enough to be found as a rename.\n' });
    sh(root, 'checkout', '-q', '-b', 'feature');
    sh(root, 'mv', 'docs/adr/0002-b.md', 'docs/adr/0001-b.md');
    write(root, { 'docs/adr/0003-zażółć.md': '# ADR-0003\n', 'docs/adr/nested/0004-c.md': '# ADR-0004\n' });
    commitAll(root, 'feature');

    expect((await addedFiles(root, 'main')).sort()).toEqual(['docs/adr/0001-b.md', 'docs/adr/0003-zażółć.md', 'docs/adr/nested/0004-c.md']);
    expect(await treeFiles(root, 'docs/adr')).toEqual(['docs/adr/0001-a.md', 'docs/adr/0001-b.md', 'docs/adr/0003-zażółć.md', 'docs/adr/nested']);
  });

  it('matches sensitive-path globs', () => {
    expect(globToRegExp('src/payments/**').test('src/payments/stripe/client.ts')).toBe(true);
    expect(globToRegExp('src/payments').test('src/payments/a.ts')).toBe(true);
    expect(globToRegExp('migrations/*.sql').test('migrations/001.sql')).toBe(true);
    expect(globToRegExp('migrations/*.sql').test('migrations/x/001.sql')).toBe(false);
    expect(globToRegExp('src/auth/**').test('src/authors.ts')).toBe(false);
  });

  it('matches `**/` as zero or more whole directories', () => {
    expect(globToRegExp('**/tests/**').test('tests/a.ts')).toBe(true);
    expect(globToRegExp('**/tests/**').test('src/tests/a.ts')).toBe(true);
    expect(globToRegExp('**/tests/**').test('src/contests/a.ts')).toBe(false);
    expect(globToRegExp('**/*.test.ts').test('a.test.ts')).toBe(true);
    expect(globToRegExp('**/*.test.ts').test('src/x/a.test.ts')).toBe(true);
    expect(globToRegExp('**/*.test.ts').test('src/x/a.ts')).toBe(false);
    expect(globToRegExp('src/**/fixtures/*.json').test('src/fixtures/a.json')).toBe(true);
  });
});
