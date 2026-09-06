import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
// Authored only. Caller separately authorizes the exact disposable target and applies 043.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/integration/delivery-attestations.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: { alias: { '@': resolve(__dirname, '.') } },
})
