import type { Account } from '@/lib/types'

export interface TrialStatus {
  isTrial: boolean
  isExpired: boolean
  daysRemaining: number
}

export function getTrialStatus(account: Account | null | undefined): TrialStatus {
  if (!account?.trial_ends_at) {
    return { isTrial: false, isExpired: false, daysRemaining: 0 }
  }
  const now = Date.now()
  const ends = new Date(account.trial_ends_at).getTime()
  const msRemaining = ends - now
  const daysRemaining = Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)))
  const isExpired = msRemaining <= 0
  return { isTrial: true, isExpired, daysRemaining }
}
