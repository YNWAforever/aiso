import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./__tests__/setup/ci-network.ts'],
    unstubGlobals: true,
    exclude: ['**/node_modules/**', 'tests/e2e/**', 'e2e/**', '**/.worktrees/**', '**/.superpowers/**'],
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
