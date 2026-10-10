import 'server-only'
import { db } from '@/lib/db'
import { isFeatureEnabled } from '@/lib/flags'
import { coverageFromCounts,type RunCoverage } from '@/lib/pulse/runs/schema'
export type MaintenanceRun=Omit<RunCoverage,'status'|'coverage'|'mentionRate'>&{id:string;week:string}
export type MaintenanceSnapshot={eligible:boolean;ledgerEnabled:boolean;runRead:'ok'|'error';sourceRead:'ok'|'error';draftRead:'ok'|'error';latestRun:MaintenanceRun|null;lastCompleteAt:string|null;awaitingSource:{id:string;versionId:string}|null;latestDraftId:string|null}
/** All reads are tenant-scoped. This must never call the coverage writer. */
export async function loadMaintenanceSnapshot(accountId:string,clientId:string,eligible:boolean):Promise<MaintenanceSnapshot>{
 const sql=db()
 const [runs,sources,drafts]=await Promise.allSettled([
  sql`with latest as (select r.* from pulse_runs r join clients c on c.id=r.client_id and c.account_id=r.account_id where r.account_id=${accountId} and r.client_id=${clientId} order by r.scan_week desc,r.id desc limit 1)
   select r.id,r.scan_week::text as week,jsonb_array_length(r.manifest->'items') as expected,count(i.id)::int as actual,
    count(i.id) filter(where i.status='succeeded')::int as succeeded,count(i.id) filter(where i.status='failed')::int as failed,
    count(i.id) filter(where i.status in ('queued','running','retry_wait'))::int as pending,count(i.id) filter(where i.status='blocked')::int as blocked,
    count(i.id) filter(where i.status='succeeded' and i.classification_status='classified')::int as classified,
    count(i.id) filter(where i.status='succeeded' and i.classification_status='classified' and a.classification->>'brandMentioned'='true')::int as mentioned,
    (select to_char(max(done.updated_at) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from pulse_runs done
      where done.account_id=${accountId} and done.client_id=${clientId} and jsonb_array_length(done.manifest->'items')>0
      and jsonb_array_length(done.manifest->'items')=(select count(*) from pulse_run_items all_items where all_items.account_id=${accountId} and all_items.client_id=${clientId} and all_items.run_id=done.id)
      and jsonb_array_length(done.manifest->'items')=(select count(*) from pulse_run_items complete where complete.account_id=${accountId} and complete.client_id=${clientId} and complete.run_id=done.id and complete.status='succeeded' and complete.classification_status='classified')
    ) as last_complete_at
   from latest r left join pulse_run_items i on i.run_id=r.id and i.account_id=${accountId} and i.client_id=${clientId}
   left join pulse_item_attempts a on a.id=i.accepted_attempt_id and a.account_id=${accountId} and a.client_id=${clientId}
   group by r.id,r.scan_week,r.manifest`,
  sql`select s.id,v.id as version_id from client_sources s join client_source_versions v on v.account_id=s.account_id and v.client_id=s.client_id and v.source_id=s.id and v.version_number=s.latest_version
   where s.account_id=${accountId} and s.client_id=${clientId} and s.revoked_at is null and v.approved_at is null order by s.updated_at desc,s.id desc limit 1`,
  sql`select id from evidence_work_items where account_id=${accountId} and client_id=${clientId} and status='draft' order by updated_at desc,id desc limit 1`,
 ])
 let latestRun:MaintenanceRun|null=null,runRead:'ok'|'error'=runs.status==='fulfilled'?'ok':'error'
 if(runs.status==='fulfilled'&&runs.value[0]){
  try{const row=runs.value[0];if(Number(row.actual)!==Number(row.expected))throw new Error('Manifest mismatch')
   const counts={expected:Number(row.expected),succeeded:Number(row.succeeded),failed:Number(row.failed),pending:Number(row.pending),blocked:Number(row.blocked),classified:Number(row.classified),mentioned:Number(row.mentioned)}
   coverageFromCounts(counts);latestRun={id:String(row.id),week:String(row.week),...counts}
  }catch{runRead='error'}
 }
 return{eligible,ledgerEnabled:isFeatureEnabled('pulse_attempts'),runRead,sourceRead:sources.status==='fulfilled'?'ok':'error',draftRead:drafts.status==='fulfilled'?'ok':'error',latestRun,
  lastCompleteAt:runs.status==='fulfilled'&&runRead==='ok'?(runs.value[0]?.last_complete_at as string|null??null):null,
  awaitingSource:sources.status==='fulfilled'&&sources.value[0]?{id:String(sources.value[0].id),versionId:String(sources.value[0].version_id)}:null,
  latestDraftId:drafts.status==='fulfilled'&&drafts.value[0]?String(drafts.value[0].id):null}
}
