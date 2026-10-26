import { execFile } from 'node:child_process';

export class GitError extends Error {
  constructor(
    readonly args: readonly string[],
    readonly stderr: string,
    readonly exitCode: number | null,
    readonly tooLarge = false,
  ) {
    super(`git ${args.join(' ')} failed${exitCode === null ? '' : ` (${exitCode})`}: ${stderr.trim()}`);
  }
}

export interface GitOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

/** Runs git without a shell, never prompting for credentials. Resolves with stdout. */
export function git(cwd: string, args: readonly string[], options: GitOptions = {}): Promise<string> {
  const { timeoutMs = 30_000, maxBytes = 10 * 1024 * 1024 } = options;
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: timeoutMs,
        maxBuffer: maxBytes,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout);
        const code = (error as NodeJS.ErrnoException).code;
        reject(
          new GitError(
            args,
            String(stderr || error.message),
            typeof code === 'number' ? code : null,
            code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
          ),
        );
      },
    );
  });
}

/** True when the command succeeds; for `--verify`-style probes. */
export async function gitSucceeds(cwd: string, args: readonly string[]): Promise<boolean> {
  try {
    await git(cwd, args);
    return true;
  } catch (error) {
    if (error instanceof GitError) return false;
    throw error;
  }
}
