import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'apps/*/tests/**/*.test.ts'],
    globalSetup: './vitest.global-setup.ts',
    testTimeout: 30_000,
    // Integration tests share one test database; keep files sequential.
    fileParallelism: false,
  },
})
