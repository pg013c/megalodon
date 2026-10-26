import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git, GitError, gitResult, gitSucceeds } from '../git/git';

/** The branch checked out in `cwd`, or null when HEAD is detached. */
export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

/** Tracked files with uncommitted changes (untracked files do not count, ADR-0014). */
export async function dirtyFiles(cwd: string): Promise<string[]> {
  const out = await git(cwd, ['status', '--porcelain', '--untracked-files=no']);
  return out.split('\n').filter(Boolean).map((line) => line.slice(3));
}

export const isAncestor = (cwd: string, ancestor: string, of: string) => gitSucceeds(cwd, ['merge-base', '--is-ancestor', ancestor, of]);

export async function mergeHead(cwd: string): Promise<string | null> {
  try {
    return (await git(cwd, ['rev-parse', '--quiet', '--verify', 'MERGE_HEAD'])).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

/** Files that would conflict if `theirs` were merged into `ours`, computed without touching any work tree. */
export async function predictConflicts(cwd: string, ours: string, theirs: string): Promise<string[]> {
  // exit 1 means conflicts: stdout is the tree, then the conflicted files
  const result = await gitResult(cwd, ['merge-tree', '--write-tree', '--name-only', '--no-messages', ours, theirs]);
  if (result.exitCode === 0) return [];
  if (result.exitCode === 1) return result.stdout.split('\n').slice(1).filter(Boolean);
  throw new Error(`git merge-tree failed: ${result.stderr.trim()}`);
}

/** Merges `ref` into the branch checked out in `cwd`. Returns the conflicted files; [] when it merged. */
export async function merge(cwd: string, ref: string, message: string): Promise<string[]> {
  try {
    await git(cwd, ['merge', '--no-ff', '--no-edit', '-m', message, ref], { timeoutMs: 120_000 });
    return [];
  } catch (error) {
    const conflicted = await unmergedFiles(cwd);
    if (conflicted.length) return conflicted;
    throw error;
  }
}

export async function unmergedFiles(cwd: string): Promise<string[]> {
  return (await git(cwd, ['diff', '--name-only', '--diff-filter=U'])).split('\n').filter(Boolean);
}

export async function abortMerge(cwd: string): Promise<void> {
  await git(cwd, ['merge', '--abort']);
}

/** Concludes a merge whose conflicts were resolved in the files. */
export async function concludeMerge(cwd: string): Promise<void> {
  await git(cwd, ['add', '-A']);
  await git(cwd, ['commit', '--no-edit', '--no-verify']);
}

export function hasConflictMarkers(cwd: string, files: readonly string[]): string[] {
  return files.filter((file) => {
    try {
      return /^(<{7}|>{7}|={7})( |$)/m.test(readFileSync(join(cwd, file), 'utf8'));
    } catch {
      return false;
    }
  });
}

/** Files the branch changed since it left `base`. */
export async function changedFiles(cwd: string, base: string, head = 'HEAD'): Promise<string[]> {
  return (await git(cwd, ['diff', '--name-only', `${base}...${head}`])).split('\n').filter(Boolean);
}

export async function deleteBranch(root: string, branch: string): Promise<void> {
  await git(root, ['branch', '-D', branch]);
}

export async function branchTip(root: string, branch: string): Promise<string | null> {
  try {
    return (await git(root, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`])).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

/** `src/payments/**` style globs, matched against repository paths. */
export function globToRegExp(glob: string): RegExp {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      pattern += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') pattern += '[^/]*';
    else if (c === '?') pattern += '[^/]';
    else pattern += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  // a plain directory covers everything below it
  return new RegExp(`^${pattern}${/[*?]/.test(glob) ? '' : '(/.*)?'}$`);
}
