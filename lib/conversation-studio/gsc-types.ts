export const STUDIO_GSC_COUNTRY = 'hkg' as const
export const STUDIO_GSC_TIME_ZONE = 'America/Los_Angeles' as const

export type StudioGscStatus =
  | 'ok' | 'empty' | 'provisional'
  | 'unbound' | 'reconnect' | 'rebind'
  | 'quota' | 'unavailable' | 'forbidden' | 'misconfigured'
  | 'unentitled' | 'disabled'

export type StudioGscSnapshot = {
  status: StudioGscStatus
  window?: { startDate: string; endDate: string; timeZone: typeof STUDIO_GSC_TIME_ZONE; lagDays: number }
  country: typeof STUDIO_GSC_COUNTRY
  totals?: { clicks: number; impressions: number; ctr?: number; position?: number }
  topQueries?: Array<{ query: string; clicks: number; impressions: number }>
  completeness: 'complete' | 'provisional' | 'unknown'
  messageKey?: string
}

/** Per-turn client state. The snapshot is display-only and is not persisted in 6d. */
export type StudioGscRead = { pending?: boolean; snapshot?: StudioGscSnapshot; error?: string }
