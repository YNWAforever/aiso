import { MAX_COMPETITORS, MAX_NAME_LENGTH } from '@/lib/competitors/limits'

/**
 * Why an attempt to add competitor names stopped short of adding all of them.
 * - `brand`: one of the names is the brand itself.
 * - `too_long`: one of the names exceeds MAX_NAME_LENGTH.
 * - `limit`: the list is already at MAX_COMPETITORS.
 */
export type CompetitorInputProblem = 'brand' | 'too_long' | 'limit'

/** "a, b，c" or one per line, as people actually paste a list. */
export function splitCompetitorInput(text: string): string[] {
  return text.split(/[,，\n]/).map(part => part.trim()).filter(Boolean)
}

/** Display form: NFC-normalised and trimmed; width and case are preserved. */
export function competitorName(value: string): string {
  return value.normalize('NFC').trim()
}

/**
 * Identity of a competitor for duplicate and own-brand comparison. NFKC folds
 * full-width and compatibility forms ("ＡＣＭＥ" → "acme"), then lower-case
 * matches the classifier's own de-duplication.
 */
export function competitorKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().trim()
}

/**
 * Adds the names in `raw` to `existing`: splits pasted lists, trims, NFC
 * normalises, ignores case/width-insensitive duplicates and stops at the shared
 * cap. A name that is the brand itself, or longer than the shared limit, adds
 * nothing and reports the problem so the caller can tell the member.
 */
export function addCompetitorNames(
  existing: readonly string[],
  raw: string,
  brandName: string,
): { competitors: string[]; problem: CompetitorInputProblem | null } {
  const brand = competitorKey(brandName)
  const incoming = splitCompetitorInput(raw).map(competitorName)
  for (const name of incoming) {
    if (name.length > MAX_NAME_LENGTH) return { competitors: [...existing], problem: 'too_long' }
    if (brand && competitorKey(name) === brand) return { competitors: [...existing], problem: 'brand' }
  }
  const competitors = [...existing]
  const seen = new Set(competitors.map(competitorKey))
  let problem: CompetitorInputProblem | null = null
  for (const name of incoming) {
    const key = competitorKey(name)
    if (seen.has(key)) continue
    if (competitors.length >= MAX_COMPETITORS) { problem = 'limit'; continue }
    seen.add(key)
    competitors.push(name)
  }
  return { competitors, problem }
}
