import { notFound } from 'next/navigation'
import { requireAuth } from '@/lib/auth'
import { isFeatureEnabled } from '@/lib/flags'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { loadOwnedWorkspace } from '@/lib/workspace/load-owned-workspace'
import { UUID } from '@/lib/outcome-integrations/input'
import { readEnterpriseArtifact } from '@/lib/enterprise/store'
import { EnterpriseWorkspace } from '@/components/enterprise/EnterpriseWorkspace'
import type { ExecutiveSnapshot } from '@/lib/enterprise/reports'
import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
export const dynamic='force-dynamic'
export default async function EnterprisePage({params,searchParams}:{params:Promise<{lang:string;clientId:string}>;searchParams:Promise<{report?:string}>}){
 const{lang,clientId}=await params,profile=await requireAuth(lang)
 if(!isFeatureEnabled('enterprise_os')||!await loadOwnedWorkspace({clientId,profile}))notFound()
 if(!resolveCommercialEntitlement(profile.accounts).features.enterprise_workflows)return <p>{(lang==='zh-HK'?zhHK:en).enterpriseOS.locked}</p>
 const query=await searchParams;let selected:ExecutiveSnapshot|null=null
 if(query.report){if(typeof query.report!=='string'||!UUID.test(query.report))notFound();const report=await readEnterpriseArtifact({accountId:profile.account_id,clientId},query.report);if(!report||report.kind!=='executive_report')notFound();selected=report.payload as ExecutiveSnapshot}
 return <EnterpriseWorkspace clientId={clientId} lang={lang} selectedReport={selected}/>
}
