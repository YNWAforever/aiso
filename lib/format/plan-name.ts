import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'
import { PLAN_IDS, type PlanId } from '@/lib/plans/catalog'

/**
 * The one way a plan is named to a person: "Pro", never the stored id "pro", and
 * translated where the name is translated. An unknown id is title-cased rather than
 * shown raw. Pure and server-safe.
 */
export function planDisplayName(plan: string | null | undefined, locale: string): string {
  const names = (locale === 'zh-HK' ? zh : en).planNames as Record<PlanId, string>
  if (plan && (PLAN_IDS as readonly string[]).includes(plan)) return names[plan as PlanId]
  if (!plan) return names.free
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}
