/**
 * Owner-registered page identity.
 *
 * AC-06 asks that a website finding and a question opportunity reach the same
 * asset. Neither side carries a page: a scan finding keeps `url.origin` and
 * reduces path, query and fragment to booleans (`origin-only.v1`), and a Pulse
 * observation has no url field at all. Rather than relax that redaction — a
 * declared evidence contract every past scan's `limitations` is written against —
 * the owner registers the pages that matter, and both sides attach to those.
 *
 * Normalisation errs towards keeping two entries rather than merging two pages:
 * a wrong merge moves one page's declared questions onto another page's
 * findings, and nothing on the screen would show that it happened.
 */

const MAX_URL_LENGTH = 1000
const MAX_LABEL_LENGTH = 160

export type AssetIdentity = { url: string; origin: string }

export function normalizeAssetUrl(input: string): AssetIdentity | null {
  const trimmed = input?.trim()
  if (!trimmed || trimmed.length > MAX_URL_LENGTH) return null

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  // http(s) only. A `javascript:` or `data:` value stored here would be rendered
  // back as a link on the owner's own dashboard.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  // Credentials in a stored, re-rendered URL are a secret with nowhere safe to be.
  if (parsed.username || parsed.password) return null
  if (!parsed.hostname) return null

  // `URL` already lowercases scheme and host and drops a default port; path and
  // query keep their case, which is correct — they are case-sensitive.
  parsed.hash = ''
  const url = parsed.toString()
  if (url.length > MAX_URL_LENGTH) return null

  return { url, origin: parsed.origin }
}

export function parseAssetLabel(input: string): string | null {
  // Interior runs collapse so that "Pricing  page" and "Pricing page" cannot sit
  // side by side looking identical.
  const label = input?.replace(/\s+/g, ' ').trim() ?? ''
  if (!label || label.length > MAX_LABEL_LENGTH) return null
  return label
}
