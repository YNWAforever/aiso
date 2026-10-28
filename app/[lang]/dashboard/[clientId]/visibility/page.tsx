import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { loadOwnedWorkspace } from '@/lib/workspace/load-owned-workspace'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { VisibilityWorkspace } from '@/components/integrations/VisibilityWorkspace'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
export const dynamic = 'force-dynamic'
export default async function VisibilityPage({params}:{params:Promise<{lang:string;clientId:string}>}) {
  const {lang,clientId}=await params,profile=await requireAuth(lang)
  if(!isFeatureEnabled('closed_loop_visibility'))notFound()
  if(!await loadOwnedWorkspace({clientId,profile}))notFound()
  if(!resolveCommercialEntitlement(profile.accounts).features.closed_loop_visibility)return <p>{(lang==='zh-HK'?zhHK:en).closedLoopVisibility.locked}</p>
  return <VisibilityWorkspace clientId={clientId} lang={lang}/>
}
