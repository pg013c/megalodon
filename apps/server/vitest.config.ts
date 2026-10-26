import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // node:sqlite is experimental in Node 22 (ADR-0018)
    execArgv: ['--disable-warning=ExperimentalWarning'],
  },
});
