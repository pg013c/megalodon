import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // node:sqlite is experimental in Node 22 (ADR-0018)
    execArgv: ['--disable-warning=ExperimentalWarning'],
    // commits made by runs in test repositories
    env: {
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  },
});
