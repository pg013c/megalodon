import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** The stable instance's data directory (ADR-0013); MEGALODON_DATA_DIR overrides it. */
export function dataDir() {
  const raw = process.env.MEGALODON_DATA_DIR ?? '~/.megalodon';
  return raw === '~' ? homedir() : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : resolve(raw);
}

export const releasesDir = () => join(dataDir(), 'releases');
