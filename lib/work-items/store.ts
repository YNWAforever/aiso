import 'server-only'
import { db } from '@/lib/db'
import { opportunityKey, serializeDraftSnapshot } from '@/lib/opportunities/fingerprint'
import { projectPulseOpportunityInput, projectScanOpportunityInput, type EvidenceVersionToken, type PersistedPulseInput, type PersistedScanInput } from '@/lib/opportunities/store'
import type { DraftSnapshotV1, SourceRef } from '@/lib/opportunities/types'
import type { CreateDraftInput, DraftEditInput, WorkItem } from './schema'
import { encodeWorkItemCursor, type WorkItemListQuery } from './query'

type Row = {id:string;client_id:string;status:'draft';title:string;action:string;notes:string;locale:WorkItem['locale'];revision:number;created_at:string;updated_at:string;evidence_snapshot:DraftSnapshotV1}
function dto(row: Row): WorkItem {
  // Validate the persisted snapshot before exposing any stored data.
  const evidenceSnapshot = JSON.parse(serializeDraftSnapshot(row.evidence_snapshot)) as DraftSnapshotV1
  return {id:row.id,clientId:row.client_id,status:row.status,title:row.title,action:row.action,notes:row.notes,locale:row.locale,revision:row.revision,createdAt:row.created_at,updatedAt:row.updated_at,evidenceSnapshot}
}
export async function loadOwnedDraftClient(accountId:string, clientId:string) {
  const sql=db()
  const rows=await sql`select id from clients where id=${clientId} and account_id=${accountId} limit 1`
  return rows[0] as {id:string}|undefined ?? null
}
export async function loadOwnedDraftSource(accountId:string,clientId:string,source:SourceRef) {
  const sql=db()
  if(source.kind==='pulse-metric') {
    const rows=await sql`select m.id,m.client_id,m.prompt_id,m.question,m.platform,m.scan_week::text as scan_week,
      to_char(m.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
      m.raw_answer,m.brand_mentioned,coalesce(m.raw_answer ~ '[^[:space:]]',false) as has_answer
      from pulse_metrics m join clients c on c.id=m.client_id
      where c.account_id=${accountId} and c.id=${clientId} and m.id=${source.id} limit 1`
    return rows[0] ? projectPulseOpportunityInput(accountId,rows[0] as PersistedPulseInput) : null
  }
  if(source.kind==='scan-check') {
    const rows=await sql`select s.id,s.client_id,s.account_id,
      to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,s.results -> 'evidence' as envelope
      from scans s join clients c on c.id=s.client_id and c.account_id=s.account_id
      where s.account_id=${accountId} and s.client_id=${clientId} and s.id=${source.id} limit 1`
    return rows[0] ? projectScanOpportunityInput(accountId,rows[0] as PersistedScanInput) : null
  }
  return null
}
export async function findOwnedDraft(accountId:string,clientId:string,key:string):Promise<WorkItem|null> {
  const sql=db()
  // opportunity_key now lives on work_item_sources, not on the item itself (051): join
  // to it and require withdrawn_at is null, so a withdrawn source's key -- free to be
  // reattached elsewhere under the partial unique index -- can never resolve back to
  // this old item. The select list stays fully qualified to `d.` alone: evidence_work_items,
  // clients and work_item_sources all have `id` and `account_id`, and the Neon HTTP driver
  // builds rows with Object.fromEntries, where a duplicate output column name silently
  // overwrites -- last one wins. Selecting any column off `c` or `s` here would risk
  // exactly that collision on `id`.
  const rows=await sql`select d.id,d.client_id,d.status,d.title,d.action,d.notes,d.locale,d.revision,
    to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
    to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,d.evidence_snapshot
    from evidence_work_items d join clients c on c.id=d.client_id and c.account_id=d.account_id
    join work_item_sources s on s.work_item_id=d.id and s.account_id=d.account_id and s.client_id=d.client_id and s.withdrawn_at is null
    where s.source_kind in ('pulse-metric','scan-check') and d.account_id=${accountId} and d.client_id=${clientId} and s.opportunity_key=${key} limit 1`
  return rows[0] ? dto(rows[0] as Row) : null
}
export async function createDraftIfEvidenceCurrent(accountId:string,clientId:string,actorId:string|null,input:CreateDraftInput,snapshot:DraftSnapshotV1,token:EvidenceVersionToken):Promise<{item:WorkItem;created:boolean}|null> {
  if(token.accountId!==accountId || token.row.client_id!==clientId || token.kind!==input.source.kind || token.row.id!==input.source.id) return null
  const sql=db(), serialized=serializeDraftSnapshot(snapshot), key=opportunityKey(input.ruleVersion,input.source)
  // source_ins is chained onto mutation as a second data-modifying CTE, in the same
  // statement: it selects FROM mutation (its RETURNING rows), not from the table, so it
  // inserts a source row if-and-only-if mutation's own on-conflict-do-nothing actually
  // inserted an item -- a conflict makes mutation return zero rows, so source_ins reads
  // zero rows too and is a no-op. Postgres runs every data-modifying CTE to completion
  // exactly once regardless of whether the final SELECT reads it, so this holds even
  // though the trailing select below names only `mutation`, never `source_ins`. That
  // keeps the item and its first source atomic without touching the on-conflict replay
  // below, which must stay a separate statement (see its own comment). Verified against
  // real PostgreSQL, not assumed, in __tests__/integration/work-item-sources.test.ts.
  //
  // Cross-reference: that same integration file's runCreateDraftCte hand-reproduces
  // this CTE's shape to run the proof above against a real database. A structural
  // change here -- renaming source_ins, changing the on-conflict target, replacing
  // source_ins's `from mutation` with a scalar subquery -- must be mirrored there too;
  // __tests__/work-items/cte-shape-parity.test.ts pins the two texts together and fails
  // the moment they drift.
  const mutation=token.kind==='pulse-metric' ? sql`
    with mutation as (
    insert into evidence_work_items (account_id,client_id,opportunity_key,source_kind,source_id,rule_version,check_key,evidence_fingerprint,evidence_snapshot,status,title,action,notes,locale,revision,created_by,updated_by)
    select c.account_id,c.id,${key},'pulse-metric',m.id,${input.ruleVersion},null,${input.fingerprint},${serialized}::jsonb,'draft',${snapshot.initialTitle},${snapshot.initialAction},'',${input.locale},1,${actorId}::uuid,${actorId}::uuid
    from clients c join pulse_metrics m on m.client_id=c.id
    where c.account_id=${accountId} and c.id=${clientId} and m.id=${token.row.id}
      and m.question is not distinct from ${token.row.question}
      and m.raw_answer is not distinct from ${token.row.raw_answer}
      and m.brand_mentioned is not distinct from ${token.row.brand_mentioned}
      and m.platform is not distinct from ${token.row.platform}
      and m.prompt_id is not distinct from ${token.row.prompt_id}::uuid
      and m.scan_week is not distinct from ${token.row.scan_week}::date
      and m.created_at is not distinct from ${token.row.created_at}::timestamptz
      and octet_length(${serialized}::jsonb::text)<=65536
    on conflict (account_id,client_id,opportunity_key) do nothing
    returning id,client_id,status,title,action,notes,locale,revision,
      to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
      to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,evidence_snapshot
    ), source_ins as (
    insert into work_item_sources (account_id,client_id,work_item_id,opportunity_key,source_kind,source_id,rule_version,check_key,evidence_fingerprint,evidence_snapshot,attached_by)
    select ${accountId}::uuid,${clientId}::uuid,mutation.id,${key},'pulse-metric',${input.source.id}::uuid,${input.ruleVersion},null,${input.fingerprint},${serialized}::jsonb,${actorId}::uuid
    from mutation
    returning id
    )
    select id,client_id,status,title,action,notes,locale,revision,created_at,updated_at,evidence_snapshot from mutation
  ` : sql`
    with mutation as (
    insert into evidence_work_items (account_id,client_id,opportunity_key,source_kind,source_id,rule_version,check_key,evidence_fingerprint,evidence_snapshot,status,title,action,notes,locale,revision,created_by,updated_by)
    select c.account_id,c.id,${key},'scan-check',s.id,${input.ruleVersion},${input.source.checkKey},${input.fingerprint},${serialized}::jsonb,'draft',${snapshot.initialTitle},${snapshot.initialAction},'',${input.locale},1,${actorId}::uuid,${actorId}::uuid
    from clients c join scans s on s.client_id=c.id and s.account_id=c.account_id
    where c.account_id=${accountId} and c.id=${clientId} and s.id=${token.row.id}
      and s.account_id is not distinct from ${token.row.account_id}::uuid
      and s.client_id is not distinct from ${token.row.client_id}::uuid
      and s.created_at is not distinct from ${token.row.created_at}::timestamptz
      and (s.results -> 'evidence') is not distinct from ${JSON.stringify(token.row.envelope)}::jsonb
      and octet_length(${serialized}::jsonb::text)<=65536
    on conflict (account_id,client_id,opportunity_key) do nothing
    returning id,client_id,status,title,action,notes,locale,revision,
      to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
      to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,evidence_snapshot
    ), source_ins as (
    insert into work_item_sources (account_id,client_id,work_item_id,opportunity_key,source_kind,source_id,rule_version,check_key,evidence_fingerprint,evidence_snapshot,attached_by)
    select ${accountId}::uuid,${clientId}::uuid,mutation.id,${key},'scan-check',${input.source.id}::uuid,${input.ruleVersion},${input.source.checkKey},${input.fingerprint},${serialized}::jsonb,${actorId}::uuid
    from mutation
    returning id
    )
    select id,client_id,status,title,action,notes,locale,revision,created_at,updated_at,evidence_snapshot from mutation
  `
  // A separate READ COMMITTED statement sees concurrent winners after conflict waiting.
  const replay=sql`select d.id,d.client_id,d.status,d.title,d.action,d.notes,d.locale,d.revision,
    to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
    to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,d.evidence_snapshot
    from evidence_work_items d join clients c on c.id=d.client_id and c.account_id=d.account_id
    where d.source_kind in ('pulse-metric','scan-check') and d.account_id=${accountId} and d.client_id=${clientId} and d.opportunity_key=${key} limit 1`
  const [written,current]=await sql.transaction([mutation,replay],{isolationLevel:'ReadCommitted'})
  const row=written[0]??current[0]
  return row ? {item:dto(row as Row),created:written.length>0} : null
}
export async function updateOwnedDraft(accountId:string,clientId:string,itemId:string,actorId:string|null,input:DraftEditInput):Promise<WorkItem|null> {
  const sql=db()
  const mutation=sql`update evidence_work_items d set title=${input.title},action=${input.action},notes=${input.notes},updated_by=${actorId}::uuid,revision=d.revision+1,updated_at=now()
    where d.source_kind in ('pulse-metric','scan-check') and d.account_id=${accountId} and d.client_id=${clientId} and d.id=${itemId} and d.revision=${input.expectedRevision}::bigint
      and exists(select 1 from clients c where c.id=d.client_id and c.account_id=d.account_id)
    returning id,client_id,status,title,action,notes,locale,revision,
      to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
      to_char(updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,evidence_snapshot`
  const replay=sql`select d.id,d.client_id,d.status,d.title,d.action,d.notes,d.locale,d.revision,
    to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
    to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,d.evidence_snapshot
    from evidence_work_items d join clients c on c.id=d.client_id and c.account_id=d.account_id
    where d.source_kind in ('pulse-metric','scan-check') and d.account_id=${accountId} and d.client_id=${clientId} and d.id=${itemId}
      and d.revision > ${input.expectedRevision}::bigint and d.title = ${input.title} and d.action = ${input.action} and d.notes = ${input.notes}`
  const [written,current]=await sql.transaction([mutation,replay],{isolationLevel:'ReadCommitted'})
  const row=written[0]??current[0]
  return row ? dto(row as Row) : null
}
export async function readOwnedDraft(accountId:string,clientId:string,itemId:string):Promise<WorkItem|null> {
  const sql=db()
  const rows=await sql`select d.id,d.client_id,d.status,d.title,d.action,d.notes,d.locale,d.revision,
    to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
    to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,d.evidence_snapshot
    from evidence_work_items d join clients c on c.id=d.client_id and c.account_id=d.account_id
    where d.source_kind in ('pulse-metric','scan-check') and d.account_id=${accountId} and d.client_id=${clientId} and d.id=${itemId} limit 1`
  return rows[0] ? dto(rows[0] as Row) : null
}
export async function listOwnedDrafts(accountId:string,clientId:string,query:WorkItemListQuery):Promise<{items:WorkItem[];nextCursor:string|null}> {
  const sql=db()
  const rows=await sql`select d.id,d.client_id,d.status,d.title,d.action,d.notes,d.locale,d.revision,
    to_char(d.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
    to_char(d.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,d.evidence_snapshot
    from evidence_work_items d join clients c on c.id=d.client_id and c.account_id=d.account_id
    where d.source_kind in ('pulse-metric','scan-check') and d.account_id=${accountId} and d.client_id=${clientId}
      and (${query.cursor===null} or (d.created_at,d.id)<(${query.cursor?.createdAt??null}::timestamptz,${query.cursor?.id??null}::uuid))
    order by d.created_at desc,d.id desc limit ${query.limit+1}`
  const items=(rows.slice(0,query.limit) as Row[]).map(dto),last=items.at(-1)
  return {items,nextCursor:rows.length>query.limit&&last ? encodeWorkItemCursor({createdAt:last.createdAt,id:last.id}) : null}
}
