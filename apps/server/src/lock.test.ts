import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireLock, DataDirLockedError } from './lock';
import { useTempDir } from './test/tempDir';

const tempDir = useTempDir();

describe('acquireLock', () => {
  it('writes the lock and removes it on release', () => {
    const dir = tempDir();
    const release = acquireLock(dir, 4600);
    const info = JSON.parse(readFileSync(join(dir, 'server.lock'), 'utf8'));
    expect(info).toMatchObject({ pid: process.pid, port: 4600 });

    release();
    expect(existsSync(join(dir, 'server.lock'))).toBe(false);
  });

  it('refuses a lock held by another live process', () => {
    const dir = tempDir();
    // the parent of the test process is alive and is not us
    writeFileSync(join(dir, 'server.lock'), JSON.stringify({ pid: process.ppid, port: 4601, startedAt: '' }));

    expect(() => acquireLock(dir, 4600)).toThrow(DataDirLockedError);
  });

  it('takes over a lock left by a process that no longer runs', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'server.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, port: 4601, startedAt: '' }));

    const release = acquireLock(dir, 4600);
    expect(JSON.parse(readFileSync(join(dir, 'server.lock'), 'utf8')).pid).toBe(process.pid);
    release();
  });
});
