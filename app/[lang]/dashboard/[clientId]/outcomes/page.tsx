import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { loadOwnedWorkspace } from '@/lib/workspace/load-owned-workspace'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { OutcomeWorkspace } from '@/components/integrations/OutcomeWorkspace'
export const dynamic = 'force-dynamic'
export default async function OutcomesPage({ params }: { params: Promise<{ lang: string; clientId: string }> }) {
  const { lang, clientId } = await params
  const profile = await requireAuth(lang)
  if (!isFeatureEnabled('outcome_integrations')) notFound()
  if (!await loadOwnedWorkspace({ clientId, profile })) notFound()
  if (!resolveCommercialEntitlement(profile.accounts).features.outcome_integrations) return <p>{(lang === 'zh-HK' ? zhHK : en).outcomeIntegrations.locked}</p>
  return <OutcomeWorkspace clientId={clientId} lang={lang}/>
}
