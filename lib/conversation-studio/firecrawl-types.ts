export type StudioFirecrawlStatus =
  | 'ok' | 'empty' | 'disabled' | 'disconnected'
  | 'unavailable' | 'auth' | 'payment' | 'rate_limit' | 'invalid' | 'misconfigured'

export type StudioFirecrawlSnapshot = {
  status: StudioFirecrawlStatus
  url?: string
  title?: string
  excerpt?: string
  contentType?: string
  messageKey?: string
}

/** Per-turn display state. Never stored with a turn and never contains a key. */
export type StudioFirecrawlRead = {
  pending?: boolean
  snapshot?: StudioFirecrawlSnapshot
  error?: string
}

/**
 * Studio scrapes an explicit public URL in the turn. An attached document only
 * contributes when the turn itself names its public URL; there is no site crawl.
 */
export function extractStudioUrl(text: string): string | null {
  if (typeof text !== 'string') return null
  const match = text.match(/https?:\/\/[^\s<>"'`]+/i)
  if (!match) return null
  const trimmed = match[0].replace(/[),.;!?]+$/u, '')
  return trimmed || null
}
