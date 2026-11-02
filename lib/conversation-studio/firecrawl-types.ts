export type StudioFirecrawlStatus =
  | 'ok' | 'empty' | 'disabled' | 'disconnected'
  | 'unavailable' | 'auth' | 'payment' | 'rate_limit' | 'invalid' | 'misconfigured'

export type StudioFirecrawlSnapshot = {
  status: StudioFirecrawlStatus
  url?: string
  title?: string
  /** Bounded markdown excerpt of the page's main content. Never raw HTML. */
  excerpt?: string
  contentType?: string
  messageKey?: string
}

/** Per-turn display state. Only this snapshot is shown with a turn; it is not persisted. */
export type StudioFirecrawlRead = { pending?: boolean; snapshot?: StudioFirecrawlSnapshot; error?: string }
