import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Explicit opt-in only: run through scripts/ci/run-exact-target-suites.mjs,
// which provisions the disposable branch this suite verifies in-band before
// writing anything. No global setup, branch creation or migration runner here.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/integration/attribution.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      'next/headers': resolve(__dirname, '__tests__/stubs/next-headers.ts'),
    },
  },
})
