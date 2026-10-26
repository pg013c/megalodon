import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PORT, loadConfig } from './config';

describe('loadConfig', () => {
  it('defaults to loopback, port 4600 and ~/.megalodon', () => {
    expect(loadConfig({}, '/web')).toEqual({
      host: '127.0.0.1',
      port: DEFAULT_PORT,
      dataDir: join(homedir(), '.megalodon'),
      webDist: null,
    });
  });

  it('reads port, data dir and web serving from the environment', () => {
    const config = loadConfig(
      { MEGALODON_PORT: '4610', MEGALODON_DATA_DIR: '~/.megalodon-dev', MEGALODON_SERVE_WEB: '1' },
      '/web',
    );
    expect(config).toMatchObject({ port: 4610, dataDir: join(homedir(), '.megalodon-dev'), webDist: '/web' });
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ MEGALODON_PORT: '70000' }, '/web')).toThrow('MEGALODON_PORT');
    expect(() => loadConfig({ MEGALODON_PORT: 'abc' }, '/web')).toThrow('MEGALODON_PORT');
  });
});
