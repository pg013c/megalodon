import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { releaseTag } from './release';
import { useTempDir } from './test/tempDir';

const tempDir = useTempDir();

/** A data dir with `releases/v0.1.0/apps/server/src/main.ts`. */
function setup() {
  const dir = tempDir();
  const src = join(dir, 'releases', 'v0.1.0', 'apps', 'server', 'src');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, 'main.ts'), '');
  return dir;
}

describe('releaseTag', () => {
  it('reads the tag of the release the module lives in', () => {
    const dir = setup();
    expect(releaseTag(join(dir, 'releases', 'v0.1.0', 'apps', 'server', 'src', 'main.ts'), join(dir, 'releases'))).toBe('v0.1.0');
  });

  it('follows the current symlink to the real tag', () => {
    const dir = setup();
    symlinkSync('v0.1.0', join(dir, 'releases', 'current'));
    expect(releaseTag(join(dir, 'releases', 'current', 'apps', 'server', 'src', 'main.ts'), join(dir, 'releases'))).toBe('v0.1.0');
  });

  it('is null for a module outside the releases', () => {
    const dir = setup();
    const src = join(dir, 'repo', 'apps', 'server', 'src');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'main.ts'), '');
    expect(releaseTag(join(src, 'main.ts'), join(dir, 'releases'))).toBeNull();
  });

  it('is null when there are no releases', () => {
    const dir = setup();
    expect(releaseTag(join(dir, 'releases', 'v0.1.0', 'apps', 'server', 'src', 'main.ts'), join(dir, 'missing'))).toBeNull();
  });
});
