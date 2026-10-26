import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const IDENTITY = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false'];

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function write(root: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/** A repository at `root` with one commit of `files` on `branch`. */
export function initRepo(root: string, files: Record<string, string> = { 'README.md': '# test\n' }, branch = 'main'): string {
  mkdirSync(root, { recursive: true });
  sh(root, 'init', '-q', '-b', branch);
  write(root, files);
  commitAll(root, 'initial');
  return root;
}

export function commitAll(root: string, message: string): void {
  sh(root, 'add', '-A');
  sh(root, 'commit', '-q', '-m', message);
}
