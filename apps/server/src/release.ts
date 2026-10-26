import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

/** The tag of `<data dir>/releases/<tag>` that `modulePath` lives in, or null in dev (ADR-0013). */
export function releaseTag(modulePath: string, releasesDir: string): string | null {
  let realModule: string;
  let realReleases: string;
  try {
    realModule = realpathSync(modulePath);
    realReleases = realpathSync(releasesDir);
  } catch {
    return null;
  }
  const rel = relative(realReleases, realModule);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep)[0] ?? null;
}
