import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'
// AUTHORED ONLY; no setup, environment loading, provisioning or migrations.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/integration/change-set-stores.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: { alias: { '@': resolve(__dirname, '.') } },
})
