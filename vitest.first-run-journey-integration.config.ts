import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

// Explicit opt-in only: the caller must separately approve and provision the
// exact disposable target, which the suite then verifies in-band before writing
// anything (see __tests__/integration/tenancy-target.ts). No global setup,
// branch creation or migration runner runs through this config — the wrapper
// provisions one branch for all of them.
//
// The next/headers alias is not optional here: this suite loads route handlers
// and services that reach it transitively, and without the stub they fail on
// import rather than on an assertion.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/integration/first-run-journey.test.ts'],
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
