export const DFS_TIME_ZONE = 'Asia/Hong_Kong' as const

export type StudioDfsStatus =
  | 'ok' | 'empty' | 'capped' | 'disabled' | 'disconnected'
  | 'unavailable' | 'auth' | 'payment' | 'rate_limit' | 'invalid' | 'misconfigured'

export type StudioDfsItem = {
  rank: number
  title: string
  url: string
  domain?: string
}

export type StudioDfsSnapshot = {
  status: StudioDfsStatus
  week?: {
    weekStart: string
    timeZone: typeof DFS_TIME_ZONE
    remaining?: number
    cap: number
  }
  locationCode?: number
  languageCode?: string
  locationPending: true
  keyword?: string
  items?: StudioDfsItem[]
  messageKey?: string
}

/** Per-turn display state. Only the snapshot may be stored with a turn, never raw vendor data. */
export type StudioDfsRead = { pending?: boolean; snapshot?: StudioDfsSnapshot; error?: string }
