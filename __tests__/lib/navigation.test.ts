import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { NAV } from '@/lib/navigation'

/**
 * The nav config declares the whole public IA up front, including the ~17 pages
 * Phase 2 has not built yet. That is only safe because these tests stop it
 * lying: an entry flipped to `available` before its page exists would put a 404
 * in the site header, on every page of the site.
 */
const en = JSON.parse(readFileSync(join(process.cwd(), 'messages/en.json'), 'utf8'))
const zh = JSON.parse(readFileSync(join(process.cwd(), 'messages/zh-HK.json'), 'utf8'))

function lookup(messages: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    messages,
  )
}

function exists(path: string): boolean {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

describe('public navigation config', () => {
  it('has at least one available entry', () => {
    expect(NAV.filter((e) => e.available).length).toBeGreaterThan(0)
  })

  it('resolves every available href to a real route', () => {
    // Checked in both locations so this holds before and after the pages move
    // into the (marketing) route group — a route group is not a path segment,
    // so either layout serves the same URL.
    const missing = NAV.filter((e) => e.available).filter((e) => {
      const seg = e.href === '/' ? '' : e.href
      return (
        !exists(join(process.cwd(), 'app/[lang]/(marketing)', seg, 'page.tsx'))
        && !exists(join(process.cwd(), 'app/[lang]', seg, 'page.tsx'))
      )
    })
    expect(missing.map((e) => e.href)).toEqual([])
  })

  it('has an en label for every entry', () => {
    expect(NAV.filter((e) => lookup(en, e.labelKey) === undefined).map((e) => e.labelKey)).toEqual([])
  })

  it('has a zh-HK label for every entry', () => {
    // A key missing here renders as the raw key to half the audience, and no
    // English-speaking reviewer would ever notice.
    expect(NAV.filter((e) => lookup(zh, e.labelKey) === undefined).map((e) => e.labelKey)).toEqual([])
  })

  it('never lists /platform/search-visibility, which is an alias and not a route', () => {
    // docs/contracts/routes.md records it as an alias only, never in
    // publicRoutes. A nav entry for it could never resolve.
    expect(NAV.map((e) => e.href)).not.toContain('/platform/search-visibility')
  })

  it('has no duplicate hrefs', () => {
    const hrefs = NAV.map((e) => e.href)
    expect(hrefs.length).toBe(new Set(hrefs).size)
  })

  it('declares every public route in the frozen contract', () => {
    // The opposite failure from the ones above: not a nav entry without a page,
    // but a page in the contract with no nav entry — a route no visitor could
    // reach from the header. docs/contracts/routes.md is frozen and
    // authoritative, so it is the source rather than this file.
    // Deliberately not in the public header. Each is excluded for a stated
    // reason rather than by a fuzzy filter, so adding a route to the contract
    // fails this test until someone decides where it belongs.
    const NOT_IN_HEADER = new Set([
      '/platform/search-visibility', // an alias, never a route
      '/onboarding', // post-signup flow, reached from the app
      '/result/demo', // a sample result, linked from content not chrome
      '/discover/hk/harbour-brew-one', // a sample entity page under /discover
      '/admin/authority', // internal
    ])

    const contract = readFileSync(join(process.cwd(), 'docs/contracts/routes.md'), 'utf8')
    const declared = new Set(NAV.map((e) => e.href))
    const inContract = [...contract.matchAll(/`\/\{loc\}(\/[a-z0-9/-]+)`/g)]
      .map((m) => m[1])
      .filter((href) => !href.startsWith('/dashboard') && !href.startsWith('/auth'))
    const missing = [...new Set(inContract)].filter(
      (href) => !declared.has(href) && !NOT_IN_HEADER.has(href),
    )
    expect(missing).toEqual([])
  })
})
