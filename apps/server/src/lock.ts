import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface LockInfo {
  pid: number;
  port: number;
  startedAt: string;
}

export class DataDirLockedError extends Error {
  constructor(readonly holder: LockInfo) {
    super(`Data directory is in use by another Megalodon server (pid ${holder.pid}, port ${holder.port})`);
  }
}

/**
 * Takes the data directory's lock so two live servers never share it (ADR-0013).
 * A lock left by a process that no longer runs is taken over. Returns the release function.
 */
export function acquireLock(dataDir: string, port: number): () => void {
  const path = join(dataDir, 'server.lock');
  const info: LockInfo = { pid: process.pid, port, startedAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(path, JSON.stringify(info), { flag: 'wx' });
      return () => release(path);
    } catch (error) {
      if (!isCode(error, 'EEXIST')) throw error;
      const holder = readHolder(path);
      if (holder && holder.pid !== process.pid && isAlive(holder.pid)) {
        throw new DataDirLockedError(holder);
      }
      unlinkSync(path);
    }
  }
  throw new Error(`Could not take the lock ${path}`);
}

function release(path: string): void {
  if (readHolder(path)?.pid === process.pid) unlinkSync(path);
}

function readHolder(path: string): LockInfo | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isCode(error, 'EPERM');
  }
}

function isCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}
