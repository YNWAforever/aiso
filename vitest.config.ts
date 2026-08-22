import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./__tests__/setup/ci-network.ts'],
    unstubGlobals: true,
    // Vitest's 5s default is not enough headroom for this suite on a contended
    // machine, and the failure is a flaky red gate rather than an honest one.
    // Two kinds of test sit close to the limit: `__tests__/api/scan-security.ts`
    // has a single rate-limit case that takes ~2.5s on an idle laptop, and the
    // `__tests__/scripts/**` tests each spawn a real `node` child process. None
    // of them hang — they are merely slow — so under load they cross 5s and a
    // different arbitrary subset fails each run. Reproduced deliberately by
    // running two full unit suites concurrently.
    //
    // This matters most where it is least visible: CI runners have 2 cores, so
    // they are more contended than the machine this was diagnosed on, and an
    // intermittently red merge gate teaches people to re-run rather than read.
    // Raise the ceiling rather than the concurrency, so genuinely hung tests
    // still fail instead of stalling the run.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // __tests__/lib/iso-date.test.ts and __tests__/lib/alerts/neon-store.test.ts
    // both pin `process.env.TZ` at module scope to make a UTC-shift regression
    // observable regardless of the machine's ambient timezone. That mutation
    // only reaches Date's internal clock in the process Vitest itself runs in
    // -- Node worker threads do not inherit a runtime TZ change, so under the
    // `threads` pool the pin is silently inert and those guards go green
    // against the exact bug they exist to catch. Pin the pool here rather than
    // relying on every TZ-sensitive test file remembering to check for it, so
    // a future one inherits the protection automatically.
    pool: 'forks',
    exclude: ['**/node_modules/**', 'tests/e2e/**', 'e2e/**', '**/.worktrees/**', '**/.superpowers/**', 'cloudflare/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
    },
    reporters: process.env.CI ? ['default', 'json', 'junit'] : ['default'],
    outputFile: process.env.CI
      ? {
          json: 'artifacts/unit-contract/vitest.json',
          junit: 'artifacts/unit-contract/vitest.junit.xml',
        }
      : undefined,
    // Inline @neondatabase/auth so Vite transforms it and applies the `next/headers`
    // alias below inside its compiled source (Vitest externalizes node_modules by
    // default, which bypasses resolve.alias for bare imports inside the package).
    server: { deps: { inline: ['@neondatabase/auth'] } },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      // @neondatabase/auth's compiled server module imports `next/headers` with a
      // bare specifier that Vitest's Node resolver can't handle; stub it in the test
      // env (real next/headers can't run in `node` anyway). See __tests__/stubs/next-headers.ts.
      'next/headers': resolve(__dirname, '__tests__/stubs/next-headers.ts'),
    },
  },
})
