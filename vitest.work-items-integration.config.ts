import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Explicit opt-in only: the caller must separately approve and provision the
// exact disposable target and apply migration 041. No global setup, branch
// creation, migration runner, environment replacement or provider cleanup runs.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/integration/evidence-work-items.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {alias: {'@': resolve(__dirname, '.')}},
})
