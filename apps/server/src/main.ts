import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { loadConfig } from './config';
import { openDatabase } from './db';
import { EventStore } from './events/store';
import { createApp } from './http/app';
import { acquireLock, DataDirLockedError } from './lock';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));

const config = loadConfig(process.env, webDist);
mkdirSync(config.dataDir, { recursive: true });

let releaseLock: () => void;
try {
  releaseLock = acquireLock(config.dataDir, config.port);
} catch (error) {
  if (error instanceof DataDirLockedError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const db = openDatabase(join(config.dataDir, 'megalodon.db'));
const store = new EventStore(db, []);
const app = createApp({ store, version: pkg.version, port: config.port, webDist: config.webDist });

const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`Megalodon ${pkg.version} on http://${config.host}:${info.port} (data: ${config.dataDir})`);
});

let stopping = false;
function shutdown(): void {
  if (stopping) return;
  stopping = true;
  server.close(() => {
    db.close();
    releaseLock();
    process.exit(0);
  });
  // open SSE streams keep the server from closing
  setTimeout(() => {
    db.close();
    releaseLock();
    process.exit(0);
  }, 2_000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
