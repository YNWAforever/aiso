import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

/**
 * Belt to the ESLint rule's braces. `no-restricted-globals` in eslint.config.mjs
 * bans bare fetch() under lib/checks/, but `npm run lint` is a separate command
 * from `npm test`, so a regression could land green locally. This asserts the
 * same invariant inside the suite that actually gates a merge.
 */
const NETWORK_CHECKS = [
  'robots.ts',
  'llmsTxt.ts',
  'botAccess.ts',
  'structuredData.ts',
  'extractability.ts',
  'llmsFullTxt.ts',
  'sitemap.ts',
  'mcpCard.ts',
]

// `fetcher(` and `fetchPublicUrl(` must not trip this, only a bare `fetch(`.
const BARE_FETCH = /(?<![A-Za-z0-9_$.])fetch\s*\(/

describe('lib/checks network modules', () => {
  it.each(NETWORK_CHECKS)('%s calls no bare fetch()', (file) => {
    const source = readFileSync(join(process.cwd(), 'lib/checks', file), 'utf8')

    expect(BARE_FETCH.test(source)).toBe(false)
  })

  it.each(NETWORK_CHECKS)('%s takes a required PublicUrlFetch', (file) => {
    const source = readFileSync(join(process.cwd(), 'lib/checks', file), 'utf8')

    expect(source).toMatch(/fetcher:\s*PublicUrlFetch(?!\s*=)/)
    // A default would silently restore the unguarded global for any caller
    // that forgets to inject — which is exactly how the SSRF bug survived.
    expect(source).not.toMatch(/fetcher:\s*PublicUrlFetch\s*=\s*fetch/)
  })
})
