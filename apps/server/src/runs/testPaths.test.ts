import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initRepo, sh, write } from '../test/repo';
import { useTempDir } from '../test/tempDir';
import { head, stepChanges } from './git';
import { testPathViolations } from './testPaths';

const tempDir = useTempDir();
const globs = ['**/tests/**', '**/*.test.ts'];

describe('testPathViolations', () => {
  const files = ['src/cart.ts', 'src/cart.test.ts', 'tests/e2e.ts', 'src/contests/a.ts'];

  it('locked: reports the test files', () => {
    expect(testPathViolations(files, globs, 'locked')).toEqual(['src/cart.test.ts', 'tests/e2e.ts']);
  });

  it('only: reports everything that is not a test file', () => {
    expect(testPathViolations(files, globs, 'only')).toEqual(['src/cart.ts', 'src/contests/a.ts']);
  });

  it('reports nothing when the step kept to its side', () => {
    expect(testPathViolations(['src/cart.ts'], globs, 'locked')).toEqual([]);
    expect(testPathViolations(['src/cart.test.ts'], globs, 'only')).toEqual([]);
  });
});

describe('stepChanges', () => {
  it('lists committed, modified, new, deleted and renamed paths since the step started, leaving the index alone', async () => {
    const root = initRepo(join(tempDir(), 'r'), { 'src/a.ts': 'a\n', 'tests/old.ts': 'old\n', 'tests/gone.ts': 'gone\n' });
    const base = await head(root);

    write(root, { 'src/committed.ts': 'c\n' });
    sh(root, 'add', '-A');
    sh(root, 'commit', '-q', '-m', 'agent committed by itself');
    writeFileSync(join(root, 'src/a.ts'), 'changed\n');
    write(root, { 'tests/new.test.ts': 'new\n' });
    rmSync(join(root, 'tests/gone.ts'));
    sh(root, 'mv', 'tests/old.ts', 'src/moved.ts');

    const changed = await stepChanges(root, base);
    expect(changed.sort()).toEqual(['src/a.ts', 'src/committed.ts', 'src/moved.ts', 'tests/gone.ts', 'tests/new.test.ts', 'tests/old.ts']);
    expect(testPathViolations(changed, globs, 'locked').sort()).toEqual(['tests/gone.ts', 'tests/new.test.ts', 'tests/old.ts']);
    expect(sh(root, 'diff', '--cached', '--name-only')).toBe('');
  });

  it('finds nothing once the step restored what it changed', async () => {
    const root = initRepo(join(tempDir(), 'r'), { 'tests/a.ts': 'a\n' });
    const base = await head(root);
    writeFileSync(join(root, 'tests/a.ts'), 'changed\n');
    write(root, { 'tests/b.ts': 'b\n' });
    expect((await stepChanges(root, base)).sort()).toEqual(['tests/a.ts', 'tests/b.ts']);

    sh(root, 'checkout', 'HEAD', '--', 'tests/a.ts');
    rmSync(join(root, 'tests/b.ts'));
    expect(await stepChanges(root, base)).toEqual([]);
  });
});
