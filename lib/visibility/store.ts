import 'server-only'
import { db } from '@/lib/db'
import { OutcomeError } from '@/lib/outcome-integrations/input'
import { outcomeHash,type OutcomeScope } from '@/lib/outcome-integrations/store'
import { normalizeBrandDomain } from '@/lib/integrations/search-console/binding'
import type { MonitoredQueryInput } from './input'
import { projectVisibilityObservation,buildVisibilityReport,type VisibilityContext } from './report'
import { generateVisibilityArtifact } from './artifacts'
import { validateVisibilityPage } from './page'
const missing=():never=>{throw new OutcomeError('VISIBILITY_NOT_FOUND',404)}
function context(brand:Record<string,unknown>):VisibilityContext {
  return {domain:normalizeBrandDomain(String(brand?.domain??''))??'',competitors:Array.isArray(brand?.competitorRefs)?brand.competitorRefs.map(raw=>{
    const row=raw as Record<string,unknown>
    return{id:typeof row.id==='string'?row.id:undefined,name:String(row.name??''),aliases:Array.isArray(row.aliases)?row.aliases as string[]:[],domains:Array.isArray(row.domains)?row.domains as string[]:[]}
  }):[]}
}
export async function saveMonitoredQuery(scope:OutcomeScope,input:MonitoredQueryInput) {
  const sql=db()
  const [owned]=await sql`select p.id from prompt_bank p join clients c on c.id=p.client_id where c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid and p.id=${input.promptId}::uuid`
  if(!owned)missing()
  const [saved]=await sql`update prompt_bank p set language=${input.locale},market=${input.market},monitoring=${JSON.stringify({...input,version:'monitored-query.v1'})}::jsonb
    from clients c where c.id=p.client_id and c.account_id=${scope.accountId}::uuid and c.id=${scope.clientId}::uuid and p.id=${input.promptId}::uuid
    and not exists(select 1 from unnest(${input.competitorIds}::uuid[]) requested(id) where not exists(select 1 from competitors k
      where k.id=requested.id and k.account_id=${scope.accountId}::uuid and k.client_id=${scope.clientId}::uuid and k.archived_at is null)) returning p.id`
  if(!saved)throw new OutcomeError('VISIBILITY_REFERENCE_NOT_FOUND',404)
  return {id:String(saved.id)}
}
async function observationRows(scope:OutcomeScope,id:string|null=null) {
  const sql=db()
  return sql`select o.*,r.review from ai_observations o left join lateral (
    select jsonb_build_object('id',v.id,'recommendation',v.recommendation,'accuracy',v.accuracy,'risk',v.risk,'notes',v.notes,'createdAt',v.created_at,'reviewerId',v.created_by) as review
    from visibility_reviews v where v.account_id=o.account_id and v.client_id=o.client_id and v.observation_id=o.id order by v.created_at desc,v.id desc limit 1
  ) r on true where o.account_id=${scope.accountId}::uuid and o.client_id=${scope.clientId}::uuid and (${id}::uuid is null or o.id=${id}::uuid)
    order by o.finished_at desc,o.id desc limit 500`
}
export async function loadVisibilityWorkspace(scope:OutcomeScope) {
  const sql=db()
  const [client]=await sql`select id,domain from clients where account_id=${scope.accountId}::uuid and id=${scope.clientId}::uuid`
  if(!client)return null
  const [queries,rows,drafts,jobs,settings,competitors]=await Promise.all([
    sql`select id,question,locale,market,is_active,monitoring,context_current from monitored_queries where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by id limit 100`,
    observationRows(scope),
    sql`select id,observation_id,kind,locale,state,artifact,created_at from visibility_drafts where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by created_at desc,id desc limit 20`,
    sql`select id,source_kind,source_id,source_run_id,retest_run_id,status,reason,attempt_count,result,created_at from visibility_revalidations where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid order by created_at desc,id desc limit 30`,
    sql`select auto_retest from visibility_settings where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid`,
    sql`select id,name from competitors where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid and archived_at is null order by name,id limit 10`,
  ])
  const observations=rows.map(row=>projectVisibilityObservation(row,context(row.brand as Record<string,unknown>)))
  return{clientId:scope.clientId,domain:client.domain,queries,observations,report:buildVisibilityReport(observations),drafts,jobs,autoRetest:settings[0]?.auto_retest===true,competitors,
    coverage:{limit:500,limitReached:rows.length===500,source:'accepted-pulse-ledger'}}
}
export async function saveVisibilityReview(scope:OutcomeScope,actor:string,input:{observationId:string;recommendation:string;accuracy:string;risk:string;notes:string}) {
  const sql=db()
  const [saved]=await sql`insert into visibility_reviews(account_id,client_id,observation_id,item_id,created_by,recommendation,accuracy,risk,notes)
    select o.account_id,o.client_id,o.id,o.item_id,p.id,${input.recommendation},${input.accuracy},${input.risk},${input.notes}
    from ai_observations o join profiles p on p.account_id=o.account_id where o.account_id=${scope.accountId}::uuid and o.client_id=${scope.clientId}::uuid
    and o.id=${input.observationId}::uuid and p.id=${actor}::uuid and p.deactivated_at is null returning id`
  if(!saved)missing()
  return{id:String(saved.id)}
}
export async function createVisibilityDraft(scope:OutcomeScope,actor:string,input:{observationId:string;kind:'brief'|'schema'|'technical_patch';locale:string}) {
  const [row]=await observationRows(scope,input.observationId)
  if(!row)missing()
  const frozen=context(row.brand as Record<string,unknown>),observation=projectVisibilityObservation(row,frozen)
  const page=input.kind==='technical_patch'&&typeof observation.monitoring.targetUrl==='string'?await validateVisibilityPage(observation.monitoring.targetUrl,frozen.domain):undefined
  const artifact=generateVisibilityArtifact(observation,input.kind,input.locale,page)
  const evidence={method:'visibility-draft.v1',observation,page:page??null},hash=outcomeHash({method:evidence.method,observation,page:page?{...page,observedAt:null}:null})
  const sql=db()
  const [saved]=await sql`insert into visibility_drafts(account_id,client_id,observation_id,item_id,created_by,kind,locale,evidence_hash,evidence,artifact)
    select o.account_id,o.client_id,o.id,o.item_id,p.id,${input.kind},${input.locale},${hash},${JSON.stringify(evidence)}::jsonb,${artifact}
    from ai_observations o join profiles p on p.account_id=o.account_id where o.account_id=${scope.accountId}::uuid and o.client_id=${scope.clientId}::uuid and o.id=${input.observationId}::uuid
    and p.id=${actor}::uuid and p.deactivated_at is null
    on conflict(account_id,client_id,observation_id,kind,locale,evidence_hash) do nothing returning id,state,artifact`
  if(saved)return saved
  const [old]=await sql`select id,state,artifact from visibility_drafts where account_id=${scope.accountId}::uuid and client_id=${scope.clientId}::uuid
    and observation_id=${input.observationId}::uuid and kind=${input.kind} and locale=${input.locale} and evidence_hash=${hash}`
  if(!old)missing()
  return old
}
