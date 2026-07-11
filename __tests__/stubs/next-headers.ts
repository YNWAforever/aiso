// Test-env stub for `next/headers`.
//
// Why this exists: `@neondatabase/auth`'s compiled server module does a bare
// `import { cookies, headers } from "next/headers"` (no file extension). Next.js's
// own bundler resolves that specially, but Vitest's Node-based resolver does not,
// so importing the real @neondatabase/auth/next/server module in a test crashes at
// import-eval time — before any code runs — for any test that transitively pulls it
// in (via @/lib/auth → @/lib/neon-auth) without mocking it.
//
// In the `node` Vitest environment the real `next/headers` can't function anyway
// (its cookies()/headers() throw outside a request scope), so aliasing it to these
// no-ops is strictly safe: tests that exercise auth behavior mock @/lib/auth or
// @/lib/neon-auth directly and never reach this; tests that only transitively import
// it (e.g. route tests) no longer crash on load.

export async function cookies() {
  return {
    get: () => undefined,
    getAll: () => [],
    set: () => {},
    delete: () => {},
    has: () => false,
  }
}

export async function headers() {
  return new Headers()
}

export function draftMode() {
  return { isEnabled: false, enable: () => {}, disable: () => {} }
}
