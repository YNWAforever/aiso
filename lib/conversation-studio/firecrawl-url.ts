/**
 * Client-safe URL helpers for Stage 6f. Only syntax lives here; the server
 * still resolves the host and refuses non-public targets before any scrape.
 */

/** Engineering guard (not a spend number): longer URLs are refused, never truncated. */
export const FIRECRAWL_URL_MAX = 2048

// Stop at whitespace, quotes, angle brackets and full-width CJK punctuation so a
// URL written inside Chinese prose does not swallow the sentence after it.
const URL_IN_TEXT = /https?:\/\/[^\s<>"'`「」『』（）《》【】，。、；：！？]+/i
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/

/** The first explicit http(s) URL in a Studio turn, or null. One URL per turn. */
export function extractTurnUrl(prompt: string): string | null {
  const match = URL_IN_TEXT.exec(prompt)
  if (!match) return null
  const url = match[0].replace(TRAILING_PUNCTUATION, '')
  return /^https?:\/\/[^/?#]/i.test(url) ? url : null
}
