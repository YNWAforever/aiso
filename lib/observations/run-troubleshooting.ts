import 'server-only'
import { db } from '@/lib/db'
export type RunItemFilter='all'|'failed'|'pending'|'unclassified'
export type RunTroubleshooting={runId:string;week:string;expected:number;succeeded:number;failed:number;pending:number;blocked:number;classified:number;total:number;items:{id:string;question:string;platform:string;model:string;status:string;classification:string;attempts:number}[];nextCursor:string|null}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export async function loadRunTroubleshooting(accountId:string,clientId:string,runId:string,filter:RunItemFilter,cursor:string|null=null):Promise<RunTroubleshooting|null>{
 if(!uuid.test(runId)||cursor!==null&&!uuid.test(cursor)||!['all','failed','pending','unclassified'].includes(filter))throw new Error('INVALID_RUN_QUERY')
 const [row]=await db()`with owned as (select r.id,r.scan_week,jsonb_array_length(r.manifest->'items') as expected from pulse_runs r join clients c on c.id=r.client_id and c.account_id=r.account_id where r.account_id=${accountId} and r.client_id=${clientId} and r.id=${runId}),
 items as materialized (select i.* from pulse_run_items i join owned r on r.id=i.run_id where i.account_id=${accountId} and i.client_id=${clientId}),
 filtered as materialized (select * from items where ${filter}='all' or (${filter}='failed' and status in ('failed','blocked')) or (${filter}='pending' and status in ('queued','running','retry_wait')) or (${filter}='unclassified' and status='succeeded' and classification_status<>'classified')),
 page as (select id,snapshot->>'question' as question,platform,model_id as model,status,classification_status as classification,attempt_count as attempts from filtered where (${cursor}::uuid is null or id>${cursor}::uuid) order by id limit 51)
 select r.id,r.scan_week::text as week,r.expected,(select count(*)::int from items) as actual,
  (select count(*)::int from items where status='succeeded') as succeeded,(select count(*)::int from items where status='failed') as failed,
  (select count(*)::int from items where status in ('queued','running','retry_wait')) as pending,(select count(*)::int from items where status='blocked') as blocked,
  (select count(*)::int from items where status='succeeded' and classification_status='classified') as classified,
  (select count(*)::int from filtered) as total,coalesce((select jsonb_agg(p order by p.id)from page p),'[]'::jsonb) as items from owned r`
 if(!row)return null
 if(Number(row.actual)!==Number(row.expected))throw new Error('RUN_EVIDENCE_UNAVAILABLE')
 const items=(row.items as RunTroubleshooting['items']).slice(0,50)
 return{runId,week:String(row.week),expected:Number(row.expected),succeeded:Number(row.succeeded),failed:Number(row.failed),pending:Number(row.pending),blocked:Number(row.blocked),classified:Number(row.classified),total:Number(row.total),items,nextCursor:(row.items as unknown[]).length>50?items.at(-1)!.id:null}
}
