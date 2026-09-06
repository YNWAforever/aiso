import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
// Caller must separately authorize the exact disposable target and apply 042.
// This configuration never provisions, migrates, loads env files or cleans providers.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/integration/change-set-approvals.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: { alias: { '@': resolve(__dirname, '.') } },
})
