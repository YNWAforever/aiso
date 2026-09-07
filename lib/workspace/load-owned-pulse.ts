import 'server-only'
import { db } from '@/lib/db'
import { MAX_PROMPTS } from '@/lib/pulse/limits'
import type { ClientOverview, PromptBankItem } from '@/lib/types'
export type PulseRead<T> = {status:'ok'|'error';data:T}
export type OwnedPulse = {
 client:{id:string;brand_name:string}
 observations:PulseRead<Record<string,unknown>[]>
 missed:PulseRead<ClientOverview['missedOpportunities']>
 prompts:PulseRead<Pick<PromptBankItem,'id'|'question'|'category'|'language'|'is_active'>[]>
}
async function read<T>(name:string,work:()=>Promise<T>,empty:T):Promise<PulseRead<T>>{try{return{status:'ok',data:await work()}}catch{console.error(`[pulse-view] ${name} read failed`);return{status:'error',data:empty}}}
export async function loadOwnedPulse({clientId,profile}:{clientId:string;profile:{account_id:string}}):Promise<OwnedPulse|null>{
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId))return null
 const sql=db();const accountId=profile.account_id
 const clients=await sql`select id,brand_name from clients where id = ${clientId} and account_id = ${accountId} limit 1`
 if(!clients[0])return null
 const [observations,missed,prompts]=await Promise.all([
  read('observations',async()=>await sql`
   with recent_weeks as (
    select s.scan_week from pulse_weekly_summary s join clients c on c.id=s.client_id where c.id=${clientId} and c.account_id=${accountId}
    union select m.scan_week from pulse_metrics m join clients c on c.id=m.client_id where c.id=${clientId} and c.account_id=${accountId}
    order by scan_week desc limit 40
   ), keys as (
    select scan_week,null::text as platform from recent_weeks
    union select s.scan_week,s.platform from pulse_weekly_summary s join clients c on c.id=s.client_id join recent_weeks w on w.scan_week=s.scan_week where c.id=${clientId} and c.account_id=${accountId}
    union select m.scan_week,m.platform from pulse_metrics m join clients c on c.id=m.client_id join recent_weeks w on w.scan_week=m.scan_week where c.id=${clientId} and c.account_id=${accountId}
   ), observations as (
    select m.scan_week,m.platform,count(*)::int as observed_queries,
     count(*) filter(where m.brand_mentioned=true and m.raw_answer ~ '[^[:space:]]')::int as observed_brand_mentions,
     count(*) filter(where m.brand_mentioned is not null and m.raw_answer ~ '[^[:space:]]')::int as successful_queries,
     count(distinct m.platform) filter(where m.brand_mentioned is not null and m.raw_answer ~ '[^[:space:]]')::int as successful_platform_count
    from pulse_metrics m join clients c on c.id=m.client_id join recent_weeks w on w.scan_week=m.scan_week
    where c.id=${clientId} and c.account_id=${accountId}
    group by grouping sets ((m.scan_week,m.platform),(m.scan_week))
   )
   select s.*,k.scan_week,k.platform,o.observed_queries,o.observed_brand_mentions,o.successful_queries,o.successful_platform_count
   from keys k left join pulse_weekly_summary s on s.scan_week=k.scan_week and s.platform is not distinct from k.platform and s.client_id=${clientId}
    and exists(select 1 from clients c where c.id=s.client_id and c.account_id=${accountId})
   left join observations o on o.scan_week=k.scan_week and o.platform is not distinct from k.platform order by k.scan_week,k.platform nulls first
  `,[]),
  read('missed',async()=>await sql`
   select m.platform,m.question,m.competitors_mentioned,m.scan_week from pulse_metrics m join clients c on c.id=m.client_id
   where c.id=${clientId} and c.account_id=${accountId} and m.brand_mentioned=false and m.raw_answer ~ '[^[:space:]]'
   order by m.scan_week desc,m.id desc limit 50
  ` as ClientOverview['missedOpportunities'],[]),
  read('prompts',async()=>await sql`
   select p.id,p.question,p.category,p.language,p.is_active from prompt_bank p join clients c on c.id=p.client_id
   where c.id=${clientId} and c.account_id=${accountId} order by p.id limit ${MAX_PROMPTS}
  ` as OwnedPulse['prompts']['data'],[]),
 ])
 return{client:{id:clients[0].id as string,brand_name:clients[0].brand_name as string},observations,missed,prompts}
}
