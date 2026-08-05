import { readFile } from 'node:fs/promises'

import { describe, it, expect } from 'vitest'

import { PLAN_IDS, getPlanDefinition } from '@/lib/plans/catalog'
import { PLATFORM_KEYS } from '@/lib/openrouter'
import {
  CITATION_PLATFORMS,
  ENTITLEMENT_TO_RUNTIME,
  RUNTIME_TO_CITATION,
  citationPlatformFor,
  runtimePlatformsFor,
} from '@/lib/pulse/platforms'

/**
 * Reads the allowed set straight out of the CHECK rather than restating it, so
 * editing the migration without editing the map fails here instead of at
 * runtime — which is how the pre-fence producer's inserts came to violate it
 * for its entire life without anyone noticing.
 */
async function allowedCitationPlatforms(): Promise<string[]> {
  const sql = await readFile(
    new URL('../../supabase/migrations/012_aiso_v3.sql', import.meta.url),
    'utf8',
  )
  const check = sql.match(/platform\s+text not null check \(platform in\s*\(([^)]*)\)/i)
  if (!check) throw new Error('ai_citation_log platform CHECK not found in 012_aiso_v3.sql')
  return [...check[1].matchAll(/'([^']+)'/g)].map(m => m[1])
}

describe('pulse platform vocabularies', () => {
  it('the entitlement and runtime vocabularies genuinely share no key', async () => {
    // The premise of this module. If they ever converge the translation can be
    // deleted — but until then, passing platform_access straight to
    // callMultiPlatform's `only` filter selects nothing at all.
    const entitlementKeys = new Set(
      PLAN_IDS.flatMap(id => getPlanDefinition(id).features.platform_access),
    )
    const shared = PLATFORM_KEYS.filter(key => entitlementKeys.has(key))

    expect(shared).toEqual([])
  })

  it('every entitlement key any plan grants translates to a real runtime key', () => {
    const runtime = new Set(PLATFORM_KEYS)
    for (const id of PLAN_IDS) {
      for (const key of getPlanDefinition(id).features.platform_access) {
        expect(ENTITLEMENT_TO_RUNTIME[key], `plan ${id} grants untranslatable "${key}"`)
          .toBeDefined()
        expect(runtime.has(ENTITLEMENT_TO_RUNTIME[key])).toBe(true)
      }
    }
  })

  it('every runtime platform translates to a citation key the CHECK allows', async () => {
    const allowed = new Set(await allowedCitationPlatforms())
    for (const key of PLATFORM_KEYS) {
      const citation = citationPlatformFor(key)
      expect(citation, `runtime platform "${key}" has no citation key`).not.toBeNull()
      expect(allowed.has(citation as string)).toBe(true)
    }
  })

  it('mirrors the migration CHECK exactly', async () => {
    expect([...CITATION_PLATFORMS].sort()).toEqual((await allowedCitationPlatforms()).sort())
  })

  it('does not confuse the two vocabularies that spell keys identically', () => {
    // "gemini" and "claude" are members of BOTH the entitlement and citation
    // vocabularies while meaning different things — the reason a single
    // canonical map would mistranslate precisely the platforms it seems to get
    // right. An entitlement key must never be usable as a runtime key.
    expect(citationPlatformFor('gemini')).toBeNull()
    expect(citationPlatformFor('claude')).toBeNull()
    expect(RUNTIME_TO_CITATION['gemini-flash']).toBe('gemini')
    expect(RUNTIME_TO_CITATION['claude-haiku']).toBe('claude')
  })

  it('resolves each plan to the platform count it advertises', () => {
    expect(runtimePlatformsFor(getPlanDefinition('free').features.platform_access)).toEqual([])
    expect(runtimePlatformsFor(getPlanDefinition('basic').features.platform_access))
      .toEqual(['gemini-flash'])
    expect(runtimePlatformsFor(getPlanDefinition('pro').features.platform_access))
      .toHaveLength(5)
    expect(runtimePlatformsFor(getPlanDefinition('enterprise').features.platform_access))
      .toHaveLength(5)
  })

  it('drops unrecognised entitlement keys rather than querying them', () => {
    expect(runtimePlatformsFor(['gemini', 'nonsense', 'gpt4o']))
      .toEqual(['gemini-flash', 'gpt-4o'])
  })

  it('google_aio is allowed by the CHECK but has no runtime producer', () => {
    // Documents the one intentional asymmetry: no OpenRouter model serves Google
    // AI Overviews, so nothing emits it today.
    expect(CITATION_PLATFORMS).toContain('google_aio')
    expect(Object.values(RUNTIME_TO_CITATION)).not.toContain('google_aio')
  })
})
