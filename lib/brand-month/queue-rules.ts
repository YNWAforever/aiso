import { SITE_EDIT_MONTHLY_SENDS_PER_BRAND } from '@/lib/site-edit/handoff'

/** A brand with active questions and no Pulse rollup for a week starting in the last 14 days is overdue (two missed weeks). */
export const PULSE_OVERDUE_DAYS = 14
/** A bound Search Console brand with no sync in this many days is stale. */
export const SEARCH_CONSOLE_STALE_DAYS = 3
/** Sends at or above this count (of the 10 a month) put a brand on the queue. */
export const NEAR_CAP_SENDS = SITE_EDIT_MONTHLY_SENDS_PER_BRAND - 2

export type QueueRow = {
  clientId: string
  brandName: string
  approvalsWaiting: number
  editsUnverified: number
  monthSends: number
  nearCap: boolean
  activeQuestions: number
  lastPulseWeek: string | null
  pulseOverdue: boolean
  searchConsole: 'not_connected' | 'ok' | 'stale'
  lastSync: string | null
  snapshotsPending: boolean
}

/** Whether a row needs anything from the operator. */
export const needsAttention = (r: QueueRow) => r.approvalsWaiting > 0 || r.editsUnverified > 0 || r.nearCap || r.pulseOverdue
  || r.searchConsole === 'stale' || r.snapshotsPending
