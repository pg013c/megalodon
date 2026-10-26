import type { Branch, BranchDiff, DiffFile, FilePatch } from '@megalodon/contracts';
import { AppError } from '../errors';
import { git, GitError, gitSucceeds } from './git';

/** The repository root containing `path`, or null when it is not inside a git work tree. */
export async function repoRoot(path: string): Promise<string | null> {
  try {
    return (await git(path, ['rev-parse', '--show-toplevel'])).trim();
  } catch (error) {
    if (error instanceof GitError) return null;
    throw error;
  }
}

export async function hasCommits(root: string): Promise<boolean> {
  return gitSucceeds(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
}

export async function localBranchExists(root: string, name: string): Promise<boolean> {
  return gitSucceeds(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}^{commit}`]);
}

/** `main`, else `master`, else the branch checked out now (ADR-0021). */
export async function detectBaseBranch(root: string): Promise<string> {
  for (const name of ['main', 'master']) if (await localBranchExists(root, name)) return name;
  return (await git(root, ['symbolic-ref', '--short', 'HEAD'])).trim();
}

const FIELD = '\x1f';

export async function listBranches(root: string, baseBranch: string): Promise<Branch[]> {
  const format = ['%(refname)', '%(refname:short)', '%(objectname)', '%(subject)', '%(authorname)', '%(committerdate:iso-strict)'].join(FIELD);
  const out = await git(root, ['for-each-ref', `--format=${format}`, '--sort=-committerdate', 'refs/heads', 'refs/remotes']);
  const rows = out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(FIELD))
    .filter(([ref]) => ref !== undefined && !ref.endsWith('/HEAD'));

  return Promise.all(
    rows.map(async ([ref = '', name = '', sha = '', subject = '', author = '', committedAt = '']) => {
      const isBase = ref === `refs/heads/${baseBranch}`;
      const [behind, ahead] = isBase ? [0, 0] : await aheadBehind(root, `refs/heads/${baseBranch}`, ref);
      return {
        name,
        kind: ref.startsWith('refs/heads/') ? ('local' as const) : ('remote' as const),
        sha,
        subject,
        author,
        committedAt,
        ahead,
        behind,
        isBase,
      };
    }),
  );
}

async function aheadBehind(root: string, base: string, ref: string): Promise<[number, number]> {
  try {
    const [behind = 0, ahead = 0] = (await git(root, ['rev-list', '--left-right', '--count', `${base}...${ref}`]))
      .trim()
      .split(/\s+/)
      .map(Number);
    return [behind, ahead];
  } catch (error) {
    if (error instanceof GitError) return [0, 0]; // unrelated histories
    throw error;
  }
}

/** Resolves a branch name from the UI to a full ref, refusing anything that is not a known branch. */
export async function resolveBranch(root: string, name: string): Promise<string> {
  if (!name || name.startsWith('-')) throw new AppError(400, 'INVALID_REF', `"${name}" is not a branch`);
  for (const ref of [`refs/heads/${name}`, `refs/remotes/${name}`]) {
    if (await gitSucceeds(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])) return ref;
  }
  throw new AppError(404, 'BRANCH_NOT_FOUND', `Branch "${name}" does not exist`);
}

/** Files the branch changes since it diverged from the base (`base...ref`). */
export async function diffFiles(root: string, baseBranch: string, name: string): Promise<BranchDiff> {
  const ref = await resolveBranch(root, name);
  const range = `refs/heads/${baseBranch}...${ref}`;
  const [statusOut, numstatOut] = await Promise.all([
    git(root, ['diff', '--no-renames', '--name-status', '-z', range]),
    git(root, ['diff', '--no-renames', '--numstat', '-z', range]),
  ]);

  const counts = new Map<string, [number | null, number | null]>();
  for (const entry of numstatOut.split('\0').filter(Boolean)) {
    const [add = '-', del = '-', ...rest] = entry.split('\t');
    counts.set(rest.join('\t'), [add === '-' ? null : Number(add), del === '-' ? null : Number(del)]);
  }

  const parts = statusOut.split('\0').filter(Boolean);
  const files: DiffFile[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const code = parts[i]!;
    const path = parts[i + 1]!;
    const [additions, deletions] = counts.get(path) ?? [null, null];
    files.push({ path, status: statusName(code), additions, deletions });
  }
  return { base: baseBranch, ref: name, files };
}

function statusName(code: string): DiffFile['status'] {
  if (code === 'A') return 'added';
  if (code === 'M') return 'modified';
  if (code === 'D') return 'deleted';
  return 'other';
}

const PATCH_LIMIT = 512 * 1024;

export async function filePatch(root: string, baseBranch: string, name: string, path: string): Promise<FilePatch> {
  const ref = await resolveBranch(root, name);
  try {
    const patch = await git(root, ['diff', '--no-renames', `refs/heads/${baseBranch}...${ref}`, '--', path], {
      maxBytes: PATCH_LIMIT,
    });
    return { path, patch, truncated: false };
  } catch (error) {
    if (error instanceof GitError && error.tooLarge) {
      return { path, patch: '', truncated: true };
    }
    throw error;
  }
}

/** Fetches every remote with the operator's own git credentials (ADR-0010). */
export async function fetchAll(root: string): Promise<void> {
  try {
    await git(root, ['fetch', '--all', '--prune'], { timeoutMs: 120_000 });
  } catch (error) {
    if (error instanceof GitError) throw new AppError(502, 'FETCH_FAILED', error.stderr.trim() || error.message);
    throw error;
  }
}
