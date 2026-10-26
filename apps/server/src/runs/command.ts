import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface CommandResult {
  exitCode: number | null;
  timedOut: boolean;
  aborted: boolean;
  /** The last few kilobytes of combined output; the whole output is in the log file. */
  tail: string;
  durationMs: number;
}

const TAIL = 4_000;

/** Runs a project command in a shell, logging its output. Used for worktree setup and checks. */
export function runCommand(
  command: string,
  options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; logPath: string; signal: AbortSignal },
): Promise<CommandResult> {
  mkdirSync(dirname(options.logPath), { recursive: true });
  appendFileSync(options.logPath, `$ ${command}\n`);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn('sh', ['-c', command], { cwd: options.cwd, env: options.env, detached: true });
    let tail = '';
    let timedOut = false;
    const onData = (chunk: Buffer) => {
      appendFileSync(options.logPath, chunk);
      tail = (tail + chunk.toString()).slice(-TAIL);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    // kill the whole process group, so `pnpm install` and friends stop too
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGTERM');
      } catch {
        // already gone
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    options.signal.addEventListener('abort', kill, { once: true });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', kill);
      resolve({ exitCode, timedOut, aborted: options.signal.aborted, tail, durationMs: Date.now() - started });
    });
    child.on('error', (error) => {
      tail += String(error);
    });
  });
}
