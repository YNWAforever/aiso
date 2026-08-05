import { vi } from 'vitest'

/**
 * Replace the global fetch with one that throws.
 *
 * Check modules take a `PublicUrlFetch` so the scan route can inject the
 * SSRF-guarded fetcher; a check that reaches for the global instead silently
 * loses DNS pinning and redirect revalidation. These tests used to stub the
 * global and let the parameter default to it, which meant a check calling bare
 * fetch() looked identical to one using the injected fetcher.
 *
 * Now the fetcher is passed explicitly, so the global must be actively hostile:
 * without this, dropping the stub would leave the *real* fetch in place and a
 * regression would quietly hit the network instead of failing.
 *
 * Note `vi.restoreAllMocks()` does not undo `vi.stubGlobal` — `vi.unstubAllGlobals()`
 * does — so call this from `beforeEach` rather than relying on a restore.
 */
export function forbidGlobalFetch(): void {
  vi.stubGlobal('fetch', vi.fn(() => {
    throw new Error(
      'A check called the global fetch. Checks must use the injected PublicUrlFetch.',
    )
  }))
}
