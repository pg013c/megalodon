// Starts the stable instance: the current release, port 4600, data in ~/.megalodon (ADR-0013).
import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir, releasesDir } from './paths.mjs';

const current = join(releasesDir(), 'current');
if (!existsSync(current)) {
  console.error('There is no release yet. Build one with: git tag v0.1.0 && pnpm release v0.1.0');
  process.exit(1);
}
const release = realpathSync(current);
console.log(`Megalodon stable from ${release}`);
const child = spawn('pnpm', ['--filter', '@megalodon/server', 'start'], {
  cwd: release,
  stdio: 'inherit',
  env: { ...process.env, MEGALODON_SERVE_WEB: '1', MEGALODON_DATA_DIR: dataDir(), MEGALODON_PORT: process.env.MEGALODON_PORT ?? '4600' },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
