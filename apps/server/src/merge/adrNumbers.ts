import { posix } from 'node:path';

/** Where a project keeps its ADRs, as `NNNN-slug.md` (ADR-0036). */
export const ADR_DIR = 'docs/adr';

/** The number of an ADR file directly in ADR_DIR, or null for any other path. */
export function adrNumber(path: string): string | null {
  if (posix.dirname(path) !== ADR_DIR || !path.endsWith('.md')) return null;
  return /^(\d{4})-/.exec(posix.basename(path))?.[1] ?? null;
}

/** Numbers held by more than one ADR file, with their files. */
export function duplicateAdrNumbers(paths: readonly string[]): Map<string, string[]> {
  const byNumber = new Map<string, string[]>();
  for (const path of paths) {
    const n = adrNumber(path);
    if (n) byNumber.set(n, [...(byNumber.get(n) ?? []), path]);
  }
  return new Map([...byNumber].filter(([, files]) => files.length > 1));
}

/**
 * Why `added` cannot land next to `paths` (the whole tree, `added` included): the first added ADR
 * whose number another file holds. A clash among files the branch did not add is not its to fix.
 */
export function adrClash(paths: readonly string[], added: readonly string[]): string | null {
  const addedSet = new Set(added);
  const next = String(Math.max(0, ...paths.map((p) => Number(adrNumber(p) ?? 0))) + 1).padStart(4, '0');
  for (const [n, files] of duplicateAdrNumbers(paths)) {
    const own = files.find((f) => addedSet.has(f));
    if (!own) continue;
    const other = files.find((f) => !addedSet.has(f));
    const holder = other ? `which ${other} already has on the base` : `which ${files.find((f) => f !== own)} takes too`;
    return `${own} takes ADR-${n}, ${holder}; renumber it to ADR-${next} and update its references ("ADR-${n}" in docs and code).`;
  }
  return null;
}
