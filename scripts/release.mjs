// Builds a release of Megalodon from a git tag into <data dir>/releases/<tag> and makes it
// current (ADR-0013). Usage: pnpm release <tag> [--force]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, symlinkSync, unlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { releasesDir } from './paths.mjs';

const [tag, flag] = process.argv.slice(2);
if (!tag) {
  console.error('Usage: pnpm release <tag> [--force]   (create the tag first: git tag v0.1.0)');
  process.exit(1);
}

const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
try {
  execFileSync('git', ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: repo, stdio: 'ignore' });
} catch {
  console.error(`There is no tag "${tag}". Create it first, e.g. git tag ${tag}`);
  process.exit(1);
}

const dest = join(releasesDir(), tag);
if (existsSync(dest)) {
  if (flag !== '--force') {
    console.error(`${dest} already exists; pass --force to build it again`);
    process.exit(1);
  }
  rmSync(dest, { recursive: true, force: true });
}
mkdirSync(dest, { recursive: true });

const run = (cmd, args, cwd) => {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd, stdio: 'inherit' });
};

// the tagged tree only: no .git, no uncommitted changes
run('sh', ['-c', `git archive --format=tar ${JSON.stringify(tag)} | tar -x -C ${JSON.stringify(dest)}`], repo);
run('pnpm', ['install', '--frozen-lockfile'], dest);
run('pnpm', ['build'], dest);

const current = join(releasesDir(), 'current');
try {
  if (lstatSync(current).isSymbolicLink()) unlinkSync(current);
} catch {
  // no current release yet
}
symlinkSync(tag, current);
console.log(`\nRelease ${tag} is current. Start it with: pnpm stable`);
