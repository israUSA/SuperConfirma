import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          include: ['packages/core/test/**/*.test.ts'],
        },
      },
      {
        test: {
          name: 'db',
          include: ['packages/db-tests/test/**/*.test.ts', 'packages/api/test/**/*.test.ts'],
          fileParallelism: false,
          testTimeout: 20_000,
        },
      },
    ],
  },
});
