export type ProviderCitation = { url: string; title: string | null }

/** Links are displayed, never fetched. Credentials and local/IP targets are excluded. */
export function safeEvidenceUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096 || /[\\\u0000-\u0020]/.test(value)) return null
  try {
    const url = new URL(value), host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (url.href.length > 4096) return null
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !host.includes('.')
      || /^[\d.]+$/.test(host) || host.includes(':') || /\.(?:localhost|local|internal)$/.test(host)) return null
    return url.href
  } catch { return null }
}

/** Null means no usable annotation envelope was recorded; [] means no accepted public citations. */
export function normalizeProviderCitations(value: unknown): ProviderCitation[] | null {
  if (!Array.isArray(value)) return null
  const citations = new Map<string, ProviderCitation>()
  for (const entry of value.slice(0, 200)) {
    if (!entry || typeof entry !== 'object') continue
    const url = safeEvidenceUrl(entry.url)
    if (!url || citations.has(url)) continue
    // Truncate by Unicode code point: slicing UTF-16 can split an emoji and
    // create a lone surrogate, which PostgreSQL JSONB rejects for the whole attempt.
    const title = typeof entry.title === 'string'
      ? Array.from(entry.title.toWellFormed().replace(/[\u0000-\u001f]/g, '').trim()).slice(0, 300).join('') || null
      : null
    citations.set(url, { url, title })
    if (citations.size === 50) break
  }
  return [...citations.values()]
}

export function citationsFromAnnotations(value: unknown): ProviderCitation[] | null {
  if (!Array.isArray(value)) return null
  return normalizeProviderCitations(value.slice(0, 200).flatMap(entry =>
    entry?.type === 'url_citation' && entry.url_citation ? [entry.url_citation] : []))
}
