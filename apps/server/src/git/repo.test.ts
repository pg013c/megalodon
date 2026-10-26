import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { commitAll, initRepo, sh, write } from '../test/repo';
import { useTempDir } from '../test/tempDir';
import { detectBaseBranch, diffFiles, fetchAll, filePatch, listBranches, repoRoot, resolveBranch } from './repo';

const tempDir = useTempDir();

/** main with one commit; feature/x adds a file, edits one, deletes one; main moves on by one commit. */
function repoWithFeature() {
  const root = initRepo(join(tempDir(), 'app'), { 'a.txt': 'a\n', 'gone.txt': 'x\n', 'img.bin': '\0\x01' });
  sh(root, 'checkout', '-q', '-b', 'feature/x');
  write(root, { 'a.txt': 'a\nb\n', 'new.txt': 'new\n', 'img.bin': '\0\x02' });
  sh(root, 'rm', '-q', 'gone.txt');
  commitAll(root, 'feature work');
  sh(root, 'checkout', '-q', 'main');
  write(root, { 'main-only.txt': 'm\n' });
  commitAll(root, 'main moves');
  return root;
}

describe('git repository reads', () => {
  it('finds the repository root, or null outside a repository', async () => {
    const root = initRepo(join(tempDir(), 'r'));
    write(root, { 'sub/file.txt': 'x' });
    expect(await repoRoot(join(root, 'sub'))).toBe(await repoRoot(root));
    expect(await repoRoot(tempDir())).toBeNull();
  });

  it('detects main, then master, then the current branch', async () => {
    expect(await detectBaseBranch(initRepo(join(tempDir(), 'm')))).toBe('main');
    expect(await detectBaseBranch(initRepo(join(tempDir(), 'ms'), undefined, 'master'))).toBe('master');
    expect(await detectBaseBranch(initRepo(join(tempDir(), 't'), undefined, 'trunk'))).toBe('trunk');
  });

  it('lists branches with ahead/behind against the base', async () => {
    const root = repoWithFeature();
    const branches = await listBranches(root, 'main');
    const byName = Object.fromEntries(branches.map((b) => [b.name, b]));

    expect(byName['main']).toMatchObject({ kind: 'local', isBase: true, ahead: 0, behind: 0 });
    expect(byName['feature/x']).toMatchObject({ kind: 'local', isBase: false, ahead: 1, behind: 1, subject: 'feature work' });
  });

  it('diffs a branch against the point where it left the base', async () => {
    const root = repoWithFeature();
    const diff = await diffFiles(root, 'main', 'feature/x');
    const files = Object.fromEntries(diff.files.map((f) => [f.path, f]));

    expect(Object.keys(files).sort()).toEqual(['a.txt', 'gone.txt', 'img.bin', 'new.txt']);
    expect(files['a.txt']).toMatchObject({ status: 'modified', additions: 1, deletions: 0 });
    expect(files['new.txt']).toMatchObject({ status: 'added', additions: 1 });
    expect(files['gone.txt']).toMatchObject({ status: 'deleted', deletions: 1 });
    expect(files['img.bin']).toMatchObject({ additions: null, deletions: null });
    // main's own later commit is not part of the branch's changes
    expect(files['main-only.txt']).toBeUndefined();
  });

  it('returns the patch of one file', async () => {
    const root = repoWithFeature();
    const patch = await filePatch(root, 'main', 'feature/x', 'a.txt');
    expect(patch.truncated).toBe(false);
    expect(patch.patch).toContain('+b');
  });

  it('refuses refs that are not branches or look like options', async () => {
    const root = repoWithFeature();
    await expect(resolveBranch(root, '--output=/tmp/x')).rejects.toMatchObject({ code: 'INVALID_REF' });
    await expect(resolveBranch(root, 'HEAD~1')).rejects.toBeInstanceOf(AppError);
    await expect(resolveBranch(root, 'nope')).rejects.toMatchObject({ code: 'BRANCH_NOT_FOUND' });
  });

  it('fetches remote branches and lists them as remote', async () => {
    const upstream = repoWithFeature();
    const clone = join(tempDir(), 'clone');
    sh(tempDir(), 'clone', '-q', upstream, clone);
    sh(upstream, 'checkout', '-q', '-b', 'later');
    write(upstream, { 'l.txt': 'l' });
    commitAll(upstream, 'later work');

    await fetchAll(clone);
    const names = (await listBranches(clone, 'main')).map((b) => `${b.kind}:${b.name}`);

    expect(names).toContain('remote:origin/later');
    expect(names).toContain('remote:origin/feature/x');
    expect(names).not.toContain('remote:origin/HEAD');
    expect(names).not.toContain('remote:origin');
  });
});
