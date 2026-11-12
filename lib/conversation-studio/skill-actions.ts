import type { PlanFeatures } from '@/lib/plans/catalog'
import { studioSkill, type StudioSkillId } from './skills'

/**
 * Pure gates for slice-4 action skills. The component asks this before showing or
 * running a confirm, so the same rules are unit-tested without a browser: an
 * action either has everything it needs, or the UI says precisely what is missing.
 */
export type StudioActionBlocker = 'needsDomain' | 'needsScan' | 'planRequired'

export function studioActionBlocker(input: {
  skillId: StudioSkillId
  brandDomain: string | null | undefined
  latestScanId: string | null | undefined
  features: Partial<PlanFeatures> | undefined
}): StudioActionBlocker | null {
  const action = studioSkill(input.skillId)?.action
  if (!action) return null
  if (action.planFeature && !input.features?.[action.planFeature]) return 'planRequired'
  if (action.id === 'scan' && !input.brandDomain) return 'needsDomain'
  if (action.id === 'improve' && !input.latestScanId) return 'needsScan'
  return null
}

/** The scan endpoint wants an absolute URL; saved brand domains are bare hosts. */
export function scanUrlFor(domain: string): string {
  return /^https?:\/\//i.test(domain) ? domain : `https://${domain}`
}

/** The Hong Kong calendar month a report run records, as `YYYY-MM`. */
export function hongKongMonthKey(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit' }).formatToParts(now)
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  if (!year || !month) throw new Error('Cannot resolve the Hong Kong month')
  return `${year}-${month}`
}

/**
 * What the confirm says it will write. Kept beside the gates so a reviewer can see
 * that no action claims more than its existing endpoint actually does.
 */
export const STUDIO_ACTION_WRITES = {
  scan: 'saves one scan (score + 20 check results) on this brand',
  improve: 'saves up to three suggestion drafts from the latest scan',
  report: 'records this month’s saved numbers in the month record',
} as const
