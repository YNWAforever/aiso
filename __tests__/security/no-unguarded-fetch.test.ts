import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Every outbound request to a host the caller can influence must cross the SSRF
 * boundary in lib/security/public-url.ts. A bare fetch() does not: no DNS
 * pinning, and redirects followed with no revalidation, so a host answering
 * 302 -> 169.254.169.254 reaches link-local space.
 *
 * __tests__/checks/no-bare-fetch.test.ts already asserted this, but only over a
 * HAND-WRITTEN list of eight files in lib/checks, so it saw neither of the two
 * live instances outside that directory: app/api/fix/route.ts fetched
 * `scan.url`, a customer-supplied URL whose body then fed an LLM prompt, and
 * lib/authority/layer2-signals.ts probed `https://${clean}` three times against
 * a caller-supplied hostname, one of them with redirect:'follow'.
 *
 * This walks the directories instead of naming files, so a NEW module is covered
 * the day it lands rather than when someone remembers to list it. Bare fetch is
 * not banned outright — a constant host this code controls is fine — but each
 * remaining call site must be declared below with its reason, which makes adding
 * one a deliberate, reviewed act.
 */

const SCANNED_DIRS = ['lib/checks', 'lib/authority', 'app/api']

/**
 * Call sites that legitimately keep the global fetch, with the reason each is
 * safe. Counts are exact, so a new bare fetch inside one of these files fails too.
 */
const ALLOWED: Record<string, { count: number; reason: string }> = {
  'app/api/cron/pulse/route.ts': {
    count: 2,
    reason: 'Self-origin driver hop to appOrigin()/api/pulse/run. The guarded fetcher '
      + 'blocks private ranges, so it would reject localhost in dev and preview.',
  },
  'app/api/scan/route.ts': {
    count: 1,
    reason: 'N8N_SCAN_WEBHOOK_URL is set by the deployment, not by a caller, and may '
      + 'address an internal n8n host that the guarded fetcher would reject as a private '
      + 'range. Note the client-configured webhook a few lines above it DOES use '
      + 'fetchPublicUrl, because that destination is customer data.',
  },
  'lib/authority/layer2-signals.ts': {
    count: 2,
    reason: 'WIKIPEDIA_API and TRANCO_API are constant hosts declared in that file; the '
      + 'caller-supplied domain appears only in the path. The three probes that do target '
      + 'a caller-supplied HOST use fetchPublicUrl.',
  },
}

// `fetcher(`, `fetchPublicUrl(` and `.fetch(` must not trip this — only a bare `fetch(`.
const BARE_FETCH = /(?<![A-Za-z0-9_$.])fetch\s*\(/g

function typeScriptFilesIn(dir: string): string[] {
  const found: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const path = join(current, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(path)
    }
  }
  walk(join(process.cwd(), dir))
  return found.map(path => relative(process.cwd(), path).split(sep).join('/'))
}

const countBareFetch = (file: string) =>
  readFileSync(join(process.cwd(), file), 'utf8').match(BARE_FETCH)?.length ?? 0

const SCANNED_FILES = SCANNED_DIRS.flatMap(typeScriptFilesIn)

describe('SSRF boundary: no unguarded outbound fetch', () => {
  it('finds files to scan in every guarded directory', () => {
    // A typo in SCANNED_DIRS would silently make this whole suite vacuous.
    for (const dir of SCANNED_DIRS) expect(typeScriptFilesIn(dir).length).toBeGreaterThan(0)
  })

  it.each(SCANNED_FILES)('%s uses the guarded fetcher, or is a declared exception', (file) => {
    const occurrences = countBareFetch(file)
    const allowed = ALLOWED[file]

    if (!allowed) {
      expect(occurrences, `${file} calls bare fetch(). Use fetchPublicUrl, or declare it in ALLOWED with a reason.`).toBe(0)
      return
    }
    expect(occurrences, `${file} is a declared exception (${allowed.reason}) but its bare fetch() count changed.`).toBe(allowed.count)
  })

  it('keeps no exception for a file that no longer needs one', () => {
    for (const file of Object.keys(ALLOWED)) {
      expect(SCANNED_FILES, `${file} is declared in ALLOWED but is not under a scanned directory.`).toContain(file)
      expect(countBareFetch(file), `${file} no longer calls bare fetch(); remove its ALLOWED entry.`).toBeGreaterThan(0)
    }
  })
})

describe('SSRF boundary: network checks still take an injected fetcher', () => {
  // Derived, not hand-listed: a new network check is covered on the day it lands.
  const injectedCheckFiles = typeScriptFilesIn('lib/checks')
    .filter(file => /PublicUrlFetch/.test(readFileSync(join(process.cwd(), file), 'utf8')))

  it('still finds the network checks', () => {
    expect(injectedCheckFiles.length).toBeGreaterThanOrEqual(8)
  })

  it.each(injectedCheckFiles)('%s takes a REQUIRED PublicUrlFetch', (file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8')
    expect(source).toMatch(/fetcher:\s*PublicUrlFetch(?!\s*=)/)
    // A default would silently restore the unguarded global for any caller that
    // forgets to inject — which is exactly how the original SSRF bug survived.
    expect(source).not.toMatch(/fetcher:\s*PublicUrlFetch\s*=/)
  })
})
