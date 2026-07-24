import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: ['**/node_modules/**', 'tests/e2e/**', 'e2e/**', '**/.worktrees/**', '**/.superpowers/**'],
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
