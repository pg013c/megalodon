import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface Config {
  /** Always loopback: Megalodon has no authentication (PRD §6). */
  host: '127.0.0.1';
  port: number;
  dataDir: string;
  /** Directory of the built web app to serve, or null when Vite serves it (dev). */
  webDist: string | null;
}

export const DEFAULT_PORT = 4600;

export function loadConfig(env: NodeJS.ProcessEnv, webDistDefault: string): Config {
  return {
    host: '127.0.0.1',
    port: parsePort(env.MEGALODON_PORT),
    dataDir: expandHome(env.MEGALODON_DATA_DIR ?? '~/.megalodon'),
    webDist: env.MEGALODON_SERVE_WEB === '1' ? webDistDefault : null,
  };
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`MEGALODON_PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return port;
}

function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return resolve(path);
}
