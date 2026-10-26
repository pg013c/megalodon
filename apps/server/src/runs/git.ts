import { existsSync } from 'node:fs';
import { git } from '../git/git';
import { localBranchExists } from '../git/repo';

/** `megalodon/12-checkout-api`, unique in the repository. */
export async function taskBranch(root: string, number: number, title: string): Promise<string> {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const base = `megalodon/${number}${slug ? `-${slug}` : ''}`;
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}-${i}`;
    if (!(await localBranchExists(root, name))) return name;
  }
}

export async function revParse(root: string, ref: string): Promise<string> {
  return (await git(root, ['rev-parse', '--verify', `${ref}^{commit}`])).trim();
}

/**
 * A new worktree on a new branch from `baseSha`. This writes only to the repository's git
 * directory (the branch ref and worktree metadata), never to the operator's working tree (ADR-0024).
 */
export async function addWorktree(root: string, path: string, branch: string, baseSha: string): Promise<void> {
  await git(root, ['worktree', 'add', '-b', branch, path, baseSha], { timeoutMs: 120_000 });
}

export const worktreeExists = (path: string) => existsSync(path);

/** Commits everything in the worktree; null when there is nothing to commit. */
export async function commitAll(cwd: string, message: string): Promise<string | null> {
  await git(cwd, ['add', '-A']);
  if ((await git(cwd, ['status', '--porcelain'])).trim() === '') return null;
  await git(cwd, ['commit', '-q', '--no-verify', '-m', message]);
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}

const DIFF_LIMIT = 60_000;

/** What the branch changed since `baseSha`, for the reviewer: a stat, then the patch, clipped. */
export async function branchDiff(cwd: string, baseSha: string): Promise<string> {
  const stat = await git(cwd, ['diff', '--stat', `${baseSha}...HEAD`]);
  const patch = await git(cwd, ['diff', `${baseSha}...HEAD`], { maxBytes: 20 * 1024 * 1024 });
  const text = `${stat}\n${patch}`;
  return text.length <= DIFF_LIMIT ? text : `${text.slice(0, DIFF_LIMIT)}\n… (diff clipped; read the files for the rest)`;
}

export async function head(cwd: string): Promise<string> {
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}
