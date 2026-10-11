import 'server-only'
import {db} from '@/lib/db'
import {getProfile} from '@/lib/auth'
import {parseCreateDraft,type CreateDraftInput} from './schema'
import {buildInitialDraftSnapshot} from './snapshot'
import {deriveSuggestions} from '@/lib/opportunities/rules'
import {groupOpportunities} from '@/lib/opportunities/groups'
import {loadOwnedDraftSource,readOwnedDraft} from './store'
import {multiSourceEnabled} from './multi-source-flag'
import type {Suggestion} from '@/lib/opportunities/types'
export async function saveGroupedDraft(accountId:string,clientId:string,actorId:string|null,inputs:CreateDraftInput[],groupKey:string){
 if(!inputs.length||inputs.length>5||inputs.some(x=>x.source.kind!=='pulse-metric')||new Set(inputs.map(x=>x.source.id)).size!==inputs.length)throw new Error('INVALID_WORK_ITEM_INPUT')
 if(inputs.length>1&&!multiSourceEnabled())throw new Error('MULTI_SOURCE_DISABLED')
 const selected=await Promise.all(inputs.map(input=>loadOwnedDraftSource(accountId,clientId,input.source)))
 const suggestions=selected.map((item,i)=>{const s=item&&deriveSuggestions(item.source).find(s=>s.source.id===inputs[i].source.id);if(!s||s.fingerprint!==inputs[i].fingerprint)throw new Error('EVIDENCE_CHANGED');return s}) as Suggestion[]
 const groups=groupOpportunities(suggestions);if(groups.length!==1||groups[0].key!==groupKey)throw new Error('INVALID_GROUP_SCOPE')
 const rows=inputs.map((input,i)=>{const item=selected[i]!,row=item.version.row as {question:string;raw_answer:string|null;platform:string;scan_week:string;classification_status?:string;brand_mentioned:boolean|null};return{key:suggestions[i].key,id:input.source.id,fingerprint:input.fingerprint,snapshot:buildInitialDraftSnapshot(suggestions[i],item.source,input.locale),question:row.question,raw:row.raw_answer,platform:row.platform,week:row.scan_week}}).sort((a,b)=>a.key.localeCompare(b.key)),first=rows[0],sql=db(),keys=rows.map(x=>x.key),context=groups[0].context
 const result=await sql.transaction([
 sql`select id from clients where id=${clientId}::uuid and account_id=${accountId} for no key update`,
 sql`with rows as(select * from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as x(key text,id uuid,fingerprint text,snapshot jsonb,question text,raw text,platform text,week date)),
 valid as(select x.* from rows x join pulse_metrics m on m.id=x.id and m.client_id=${clientId}::uuid join clients c on c.id=m.client_id and c.account_id=${accountId} left join pulse_run_items i on i.id=m.run_item_id and i.account_id=c.account_id and i.client_id=c.id where m.question is not distinct from x.question and m.raw_answer is not distinct from x.raw and m.platform=x.platform and m.scan_week=x.week and m.classification_status='classified' and m.brand_mentioned=false and (${context?.runId??null}::uuid is null or (i.run_id=${context?.runId??null}::uuid and i.snapshot->>'market'=${context?.market??null} and i.snapshot->>'language'=${context?.language??null}))),
 prior_ids as(select work_item_id as id from work_item_groups where account_id=${accountId} and client_id=${clientId}::uuid and group_key=${groupKey} union select work_item_id from work_item_sources where account_id=${accountId} and client_id=${clientId}::uuid and opportunity_key=any(${keys}::text[]) and withdrawn_at is null),
 permitted as(select c.id from clients c where c.account_id=${accountId} and c.id=${clientId}::uuid and (select count(*) from valid)=${rows.length} and (select count(*) from prior_ids)<=1),
 created as(insert into evidence_work_items(account_id,client_id,opportunity_key,source_kind,source_id,rule_version,evidence_fingerprint,evidence_snapshot,title,action,locale,created_by,updated_by) select ${accountId},id,${first.key},'pulse-metric',${first.id}::uuid,'pulse-brand-absent.v1',${first.fingerprint},${JSON.stringify(first.snapshot)}::jsonb,${first.snapshot.initialTitle},${first.snapshot.initialAction},${inputs[0].locale},${actorId}::uuid,${actorId}::uuid from permitted where not exists(select 1 from prior_ids) on conflict(account_id,client_id,opportunity_key) do nothing returning id),
 chosen as(select id from created union all select id from prior_ids where exists(select 1 from permitted)),
 sources as(insert into work_item_sources(account_id,client_id,work_item_id,opportunity_key,source_kind,source_id,rule_version,evidence_fingerprint,evidence_snapshot,attached_by) select ${accountId},${clientId}::uuid,d.id,x.key,'pulse-metric',x.id,'pulse-brand-absent.v1',x.fingerprint,x.snapshot,${actorId}::uuid from chosen d,valid x where not exists(select 1 from work_item_sources old where old.account_id=${accountId} and old.client_id=${clientId}::uuid and old.opportunity_key=x.key and old.withdrawn_at is null) returning id),
 bumped as(update evidence_work_items set revision=revision+1,updated_at=now() where account_id=${accountId} and client_id=${clientId}::uuid and id in(select id from chosen) and not exists(select 1 from created) and exists(select 1 from sources) returning id),
 mapped as(insert into work_item_groups(account_id,client_id,group_key,work_item_id,scope_snapshot) select ${accountId},${clientId}::uuid,${groupKey},id,${JSON.stringify(groups[0])}::jsonb from chosen on conflict(account_id,client_id,group_key) do nothing returning work_item_id)
 select id from chosen`,
 sql`select g.work_item_id,1/(case when (select count(*) from work_item_sources s where s.account_id=${accountId} and s.client_id=${clientId}::uuid and s.work_item_id=g.work_item_id and s.opportunity_key=any(${keys}::text[]) and s.withdrawn_at is null)=${rows.length} then 1 else 0 end) as complete from work_item_groups g where g.account_id=${accountId} and g.client_id=${clientId}::uuid and g.group_key=${groupKey}`
 ])
 const id=result[2][0]?.work_item_id;if(!id)throw new Error('GROUP_EVIDENCE_CONFLICT');return{item:await readOwnedDraft(accountId,clientId,String(id)),group:groups[0]}
}
export async function saveAuthenticatedGroup(clientId:string,raw:unknown){const profile=await getProfile();if(!profile)throw new Error('UNAUTHENTICATED');const body=raw as {groupKey:string;sources:unknown[]};if(!body||typeof body.groupKey!=='string'||!Array.isArray(body.sources))throw new Error('INVALID_WORK_ITEM_INPUT');return saveGroupedDraft(profile.account_id,clientId,profile.id,body.sources.map(parseCreateDraft),body.groupKey)}
