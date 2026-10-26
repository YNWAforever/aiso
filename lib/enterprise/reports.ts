import 'server-only'
import { db } from '@/lib/db'
import type { OutcomeScope } from '@/lib/outcome-integrations/store'
import { loadBinding } from '@/lib/integrations/search-console/store'
import { normalizeBrandDomain,bindingMatchesDomain } from '@/lib/integrations/search-console/binding'
import { readScanEvidence } from '@/lib/scan-evidence'
import { projectVisibilityObservation,buildVisibilityReport,type VisibilityContext } from '@/lib/visibility/report'
import { parsePortalConfig } from './input'
function executiveContext(value:unknown):VisibilityContext{
 const brand=value&&typeof value==='object'?value as Record<string,unknown>:{},strings=(v:unknown)=>Array.isArray(v)?v.filter((item):item is string=>typeof item==='string'):[]
 return{domain:normalizeBrandDomain(typeof brand.domain==='string'?brand.domain:'')??'',competitors:(Array.isArray(brand.competitorRefs)?brand.competitorRefs:[]).flatMap(value=>{if(!value||typeof value!=='object')return[];const ref=value as Record<string,unknown>;if(typeof ref.name!=='string'||!ref.name.trim())return[];return[{id:typeof ref.id==='string'?ref.id:undefined,name:ref.name,domains:strings(ref.domains),aliases:strings(ref.aliases)}]})}
}
export type PortalConfig=ReturnType<typeof parsePortalConfig>
export async function buildExecutiveSnapshot(scope:OutcomeScope,window:{start:string;end:string},branding:PortalConfig){
 const sql=db(),binding=await loadBinding(scope.accountId,scope.clientId),boundAt=binding&&bindingMatchesDomain(binding,binding.currentDomain)?binding.boundAt:null
 const [clients,scans,search,analytics,observations,connector]=await Promise.all([
  sql`select brand_name,domain from clients where account_id=${scope.accountId}::uuid and id=${scope.clientId}::uuid`,
  sql`select score,created_at,results->'evidence' as evidence from scans where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and created_at<${window.end}::date+1 order by created_at desc,id desc limit 1`,
  sql`select sum(clicks)::float8 as clicks,sum(impressions)::float8 as impressions,sum(position*impressions)/nullif(sum(impressions),0) as position,count(*)::int as days,max(date) as through
    from search_console_daily where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and scope='property'
    and date>=${window.start}::date and date<=${window.end}::date and synced_at>=${boundAt}::timestamptz
    and exists(select 1 from search_console_bindings where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and bound_at=${boundAt}::timestamptz)`,
  sql`select currency,sum(sessions)::float8 as sessions,sum(conversions)::float8 as conversions,sum(revenue_minor)::float8 as revenue_minor,count(*)::int as events
    from outcome_events where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and kind='analytics' and occurred_at>=${window.start}::date and occurred_at<${window.end}::date+1 group by currency order by currency limit 20`,
  sql`select o.*,count(*) over()::int as total from ai_observations o where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and finished_at>=${window.start}::date and finished_at<${window.end}::date+1 order by finished_at desc,id desc limit 500`,
  sql`select count(*)::int as observations,count(distinct run_id)::int as runs from enterprise_adapter_observations where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and observed_at>=${window.start}::date and observed_at<${window.end}::date+1`,
 ])
 if(!clients[0])return null
 const projected=observations.map(row=>{const context=executiveContext(row.brand);
  // Older manifests omit domains. Missing identity cannot be attributed to a
  // client's current domain after a rename; retain citation aggregates unknown.
  return projectVisibilityObservation(context.domain?row:{...row,provider_citations:null},context)})
 const report=buildVisibilityReport(projected),scan=scans[0],evidence=readScanEvidence(scan?.evidence)
 return{version:'executive-report.v1',locale:branding.locale,generatedAt:new Date().toISOString(),window,client:{name:String(clients[0].brand_name??clients[0].domain),domain:String(clients[0].domain)},branding,
  technical:scan?{score:scan.score,recordedAt:scan.created_at,method:evidence?.headlineMethod??null,collection:evidence?.collection??'unknown',scope:evidence?.completedScope??'unknown'}:null,
  retrieval:{status:'unavailable',reason:'no-verified-log-connector'},outcomes:{search:search[0]??null,analyticsByCurrency:analytics},
  visibility:{observations:report.observations,availableObservations:Number(observations[0]?.total??0),classified:report.classified,unknown:report.unknown,answerPresence:report.answerPresence,citationShare:report.citationShare,citationCoverage:report.citationCoverage,firstCitationPosition:report.firstCitationPosition,
   brandShareOfVoice:report.brandShareOfVoice,competitorShareOfVoice:report.competitorShareOfVoice,volatility:report.volatility,trustedSources:report.trustedSources.slice(0,10),method:report.method,provenance:'accepted-provider-ledger',connectorReported:connector[0]??{observations:0,runs:0}},
  limitations:['technical-readiness-is-not-observed-retrieval','stored-outcomes-may-have-reporting-lag','currency-not-converted','latest-500-observations-within-window','search-annotation-order-not-ranking','recurring-source-authority-is-a-fimmick-heuristic','no-ranking-or-inclusion-guarantees','association-not-causation']}
}
export type ExecutiveSnapshot=NonNullable<Awaited<ReturnType<typeof buildExecutiveSnapshot>>>
/** Public consumers never receive the private upstream logo URL. */
export function publicExecutiveSnapshot(snapshot:ExecutiveSnapshot,logoProxy:string|null){return{...snapshot,branding:{...snapshot.branding,logoUrl:logoProxy}}}
