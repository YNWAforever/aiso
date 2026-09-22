import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/integration/**/*.test.ts'],
    exclude: ['__tests__/integration/delivery-attestations.test.ts', '__tests__/integration/change-set-stores.test.ts', '__tests__/integration/change-set-approvals.test.ts', '__tests__/integration/client-entities.test.ts', '__tests__/integration/evidence-work-items.test.ts', '__tests__/integration/first-run-journey.test.ts', '__tests__/integration/feature-store-tenancy.test.ts', '__tests__/integration/reports-entities-tenancy.test.ts', '__tests__/integration/alerts-agents-tenancy.test.ts'],
    globalSetup: ['__tests__/integration/setup.ts'],
    // One shared branch per run: parallel files would race on the same schema.
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
