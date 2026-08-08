import { PLATFORM_KEYS } from '@/lib/openrouter'

/**
 * Three platform vocabularies exist in this codebase, and they do not agree.
 *
 *   1. **Entitlement keys** — `PlanFeatures.platform_access` in lib/plans/catalog.ts:
 *      `gemini`, `gpt4o`, `claude`, `perplexity-s`, `perplexity-p`
 *   2. **Runtime keys** — what `callMultiPlatform` emits and what lands in
 *      `pulse_metrics.platform` (and which `components/pulse/PlatformBar.tsx`
 *      rewrites for display): `gemini-flash`, `gpt-4o`, `claude-haiku`,
 *      `perplexity-sonar`, `perplexity-sonar-pro`
 *   3. **Citation keys** — the CHECK on `ai_citation_log.platform`
 *      (012_aiso_v3.sql:57-58): `gemini`, `chatgpt`, `claude`, `perplexity_sonar`,
 *      `perplexity_sonar_pro`, `google_aio`
 *
 * Vocabularies 1 and 2 have **zero** overlap, so passing `platform_access`
 * straight into `callMultiPlatform`'s `only` filter selects no platforms at all
 * and a run silently does nothing. Vocabularies 2 and 3 also have zero overlap,
 * which is why every `ai_citation_log` insert the pre-fence producer attempted
 * violated its CHECK — and it destructured no error, so it reported a citation
 * count while writing none.
 *
 * The trap is that 1 and 3 *partially* overlap: `gemini` and `claude` are
 * spelled identically in both but mean different things (an entitlement vs a
 * storage key), so a single "canonical" map looks like it works and mistranslates
 * exactly the two platforms it appears to handle. Hence two named, directional
 * maps and the boundary tests in __tests__/lib/pulse-platforms.test.ts, which
 * fail if any vocabulary gains a member without a translation.
 */

/** Entitlement key (vocabulary 1) → runtime key (vocabulary 2). */
export const ENTITLEMENT_TO_RUNTIME: Readonly<Record<string, string>> = {
  'gemini': 'gemini-flash',
  'gpt4o': 'gpt-4o',
  'claude': 'claude-haiku',
  'perplexity-s': 'perplexity-sonar',
  'perplexity-p': 'perplexity-sonar-pro',
}

/** Runtime key (vocabulary 2) → citation-log key (vocabulary 3). */
export const RUNTIME_TO_CITATION: Readonly<Record<string, string>> = {
  'perplexity-sonar': 'perplexity_sonar',
  'perplexity-sonar-pro': 'perplexity_sonar_pro',
  'gpt-4o': 'chatgpt',
  'claude-haiku': 'claude',
  'gemini-flash': 'gemini',
}

/**
 * The full allowed set from the `ai_citation_log.platform` CHECK. `google_aio`
 * has no runtime producer — no OpenRouter model serves Google AI Overviews — so
 * it is reachable only by a future non-OpenRouter collector.
 */
export const CITATION_PLATFORMS: readonly string[] = [
  'perplexity_sonar', 'perplexity_sonar_pro', 'chatgpt', 'claude', 'gemini', 'google_aio',
]

/**
 * Translates a plan's `platform_access` into the runtime keys `callMultiPlatform`
 * understands, dropping anything unrecognised rather than querying it.
 *
 * Returning `[]` for a plan that grants nothing is meaningful, not a failure: the
 * caller must refuse the run instead of falling through to "query everything",
 * which is what an untranslated empty filter would have done.
 */
export function runtimePlatformsFor(platformAccess: readonly string[]): string[] {
  const known = new Set(PLATFORM_KEYS)
  return platformAccess
    .map(key => ENTITLEMENT_TO_RUNTIME[key])
    .filter((key): key is string => Boolean(key) && known.has(key))
}

/** Runtime key → citation key, or `null` when the platform cannot be logged. */
export function citationPlatformFor(runtimeKey: string): string | null {
  return RUNTIME_TO_CITATION[runtimeKey] ?? null
}
