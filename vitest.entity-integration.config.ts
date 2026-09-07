import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Explicit opt-in only: the caller must separately approve and provision the
// exact disposable target and apply migration 040. No global setup, branch
// creation, migration runner or provider cleanup runs through this config.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/integration/client-entities.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {alias: {'@': resolve(__dirname, '.')}},
})
