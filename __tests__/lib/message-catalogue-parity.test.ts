import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { routing } from '@/i18n/routing'

/**
 * Every message key exists in every language, with the same shape and the same
 * ICU arguments.
 *
 * Per-surface parity tests already exist, but between them they cover a handful of
 * namespaces — the rest of the catalogue had no parity assertion at all. A key
 * that reaches only `en.json` renders as a visible key path in zh-HK and logs an
 * error, so the failure is loud at runtime and completely silent in the suite,
 * which is the wrong way round.
 *
 * There is **no allow-list**, because there is no drift: both catalogues carry
 * 1727 leaves with zero differences on every axis below. An allow-list here would
 * have no entries, and adding an empty one would only teach the next person that
 * the list is where drift goes to be tolerated.
 *
 * The locale list comes from `i18n/routing.ts`, not a hardcoded pair, so a third
 * locale is covered the day it is added rather than the day someone remembers.
 *
 * This does NOT replace the existing per-surface tests, and they must not be
 * weakened to match it. They assert things set-parity cannot: that en and zh
 * render *different* strings for the same state (so an English fallback fails),
 * and that the catalogue covers vocabularies read from source — the outcome reason
 * codes, the prompt categories, the SOURCES_* error codes. Reading an expectation
 * from the code is strictly stronger than comparing two catalogues to each other.
 */

type Leaves = Record<string, unknown>

// readFileSync + JSON.parse rather than `import ... from '@/messages/en.json'`:
// the established shape here, and it keeps a 1727-key inferred type out of
// `tsc --noEmit`, which typechecks tests.
function load(locale: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(process.cwd(), 'messages', `${locale}.json`), 'utf8'))
}

function flatten(value: unknown, prefix = '', out: Leaves = {}): Leaves {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out)
    }
  } else {
    out[prefix] = value
  }
  return out
}

const DEFAULT = routing.defaultLocale
const OTHERS = routing.locales.filter(locale => locale !== DEFAULT)

const catalogues = Object.fromEntries(
  routing.locales.map(locale => [locale, flatten(load(locale))]),
) as Record<string, Leaves>

const shapeOf = (value: unknown) => (Array.isArray(value) ? 'array' : typeof value)

/**
 * The anchor on `}` or a known ICU type is load-bearing. A naive `\{\s*(\w+)`
 * matches the first word inside a plural body — `=0 {No trust actions ready yet.}`
 * yields "No" — and produces false positives on the three keys that use plurals.
 */
const ICU_ARGUMENT =
  /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\}|,\s*(?:plural|select|selectordinal|number|date|time)\b)/g

const icuArguments = (value: unknown): string[] =>
  typeof value === 'string'
    ? [...new Set([...value.matchAll(ICU_ARGUMENT)].map(match => match[1]!))].sort()
    : []

describe.each(OTHERS)('%s matches the en catalogue', locale => {
  const base = catalogues[DEFAULT]!
  const other = catalogues[locale]!

  it('declares exactly the same keys, in both directions', () => {
    // Reported as two difference lists rather than a toEqual on sorted 1727-element
    // arrays, which produces an unreadable diff at this size. Both directions
    // matter: a key only in zh-HK is dead copy, and costs nothing to catch.
    const missing = Object.keys(base).filter(key => !(key in other))
    const extra = Object.keys(other).filter(key => !(key in base))

    expect({ missing, extra }).toEqual({ missing: [], extra: [] })
  })

  it('keeps the same value shape at every key', () => {
    // A string that became an object passes key parity and breaks at render.
    const mismatched = Object.keys(base)
      .filter(key => key in other && shapeOf(base[key]) !== shapeOf(other[key]))
      .map(key => `${key}: ${shapeOf(base[key])} vs ${shapeOf(other[key])}`)

    expect(mismatched).toEqual([])
  })

  it('keeps arrays the same length', () => {
    // 20 leaves are arrays, all under publicPages.*.actions. One element short in
    // a translation silently drops a call to action.
    const mismatched = Object.keys(base)
      .filter(key => Array.isArray(base[key]) && Array.isArray(other[key]))
      .filter(key => (base[key] as unknown[]).length !== (other[key] as unknown[]).length)

    expect(mismatched).toEqual([])
  })

  it('keeps the same ICU arguments in every message', () => {
    // Key parity cannot see a translator dropping {score} from a message that
    // interpolates it — the key is still there, and the number simply vanishes
    // from the sentence.
    const mismatched = Object.keys(base)
      .filter(key => typeof base[key] === 'string')
      .filter(key => icuArguments(base[key]).join(',') !== icuArguments(other[key]).join(','))
      .map(key => `${key}: [${icuArguments(base[key])}] vs [${icuArguments(other[key])}]`)

    expect(mismatched).toEqual([])
  })
})

describe.each(routing.locales)('%s is complete', locale => {
  it('has no empty or whitespace-only message', () => {
    // An empty string satisfies every assertion above and renders as nothing.
    const blank = Object.entries(catalogues[locale]!)
      .filter(([, value]) => typeof value === 'string' && !value.trim())
      .map(([key]) => key)

    expect(blank).toEqual([])
  })
})

/**
 * Guard the guard.
 *
 * Every assertion above compares the catalogues to each other, so all of them go
 * green if the locale list empties or a catalogue collapses — the suite would
 * report success having compared nothing, which is the exact failure it exists to
 * prevent. Set equality also survives a *symmetric* deletion: removing a namespace
 * from both files at once keeps parity perfect. The anchored namespace list is the
 * only assertion here that catches that.
 */
describe('the parity check cannot pass vacuously', () => {
  it('has at least two locales, including the two this product ships', () => {
    expect(routing.locales.length).toBeGreaterThanOrEqual(2)
    expect(routing.locales).toContain('en')
    expect(routing.locales).toContain('zh-HK')
    expect(DEFAULT).toBe('en')
  })

  it('still declares every top-level namespace', () => {
    // Hardcoded on purpose, in the idiom of check-explanations-parity.test.ts.
    // Adding a namespace is a deliberate edit here; deleting one from both
    // catalogues at once is exactly what set equality misses.
    expect(Object.keys(load(DEFAULT)).sort()).toEqual([
      'activation',
      'alertFeedback', 'approverAccess', 'auth', 'changeSets', 'checks', 'dashboard',
      'delivery', 'entities', 'generatedWork', 'home', 'members', 'methodologyPage', 'nav',
      'observations', 'opportunities', 'outcomes', 'portfolio', 'pricing',
      'publicPages', 'pulse', 'pulseView', 'reportBranding', 'reports', 'result',
      'sampleReport', 'scanPage', 'seo', 'settings', 'sources', 'unavailable',
      'upsell', 'workspaceHome',
    ])
  })

  it('still holds a full catalogue rather than a stub', () => {
    // A tripwire, not a target. 1727 today.
    expect(Object.keys(catalogues[DEFAULT]!).length).toBeGreaterThan(1700)
  })
})
