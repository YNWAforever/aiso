import 'server-only'
import { db } from '@/lib/db'
import { SourceInputError,sourceFreshness,type SourceDto } from './schema'
import { encodeSourceCursor,type SourceQuery } from './query'
import type { SourceScope } from './store'
export type SourceSummary=Omit<SourceDto,'current'>&{current:(Omit<NonNullable<SourceDto['current']>,'entries'>&{entryCount:number})|null}
export type SourcePage={items:SourceSummary[];nextCursor:string|null;total:number;asOf:string}
type PageRow={id:string;source_key:string;kind:SourceDto['kind'];label:string;agent_use_allowed:boolean;revoked_at:string|null;latest_version:number;updated_at:string;created_at:string;version_id:string|null;content_hash:string;import_method:'paste'|'csv';origin_ref:string|null;imported_at:string;approved_at:string|null;approved_by:string|null;entry_count:number}
export async function listSourcePage(scope:SourceScope,query:SourceQuery):Promise<SourcePage|null>{
 // Fingerprint every source's version/policy metadata, then read content only
 // after the page boundary. Materializing content counts before LIMIT would
 // decompress every source again on every page.
 const sql=db(),cursor=query.cursor
 const [result]=await sql`
  with owned as (select id from clients where account_id=${scope.accountId} and id=${scope.clientId}),
  all_sources as materialized (
   select s.*,v.id as version_id,v.content_hash,v.import_method,v.origin_ref,v.imported_at,v.approved_at,v.approved_by
   from client_sources s left join client_source_versions v on v.account_id=s.account_id and v.client_id=s.client_id and v.source_id=s.id and v.version_number=s.latest_version
   where s.account_id=${scope.accountId} and s.client_id=${scope.clientId}
  ), meta as (select to_char(coalesce(${cursor?.asOf??null}::timestamptz,clock_timestamp()) at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as as_of,md5(coalesce(jsonb_agg(to_jsonb(all_sources) order by id),'[]'::jsonb)::text) as epoch from all_sources),
  matching as materialized (
   select s.* from all_sources s,meta where s.created_at<=meta.as_of::timestamptz and (
    ${query.filter}='all' or (${query.filter}='revoked' and s.revoked_at is not null) or
    (${query.filter}='awaiting-approval' and s.revoked_at is null and s.approved_at is null) or
    (${query.filter}='in-use' and s.revoked_at is null and s.approved_at is not null and s.agent_use_allowed))
  ), page as materialized (
   select id,source_key,kind,label,agent_use_allowed,revoked_at,latest_version,updated_at,
    to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
    version_id,content_hash,import_method,origin_ref,imported_at,approved_at,approved_by
   from matching where (${cursor===null} or (created_at,id)<(${cursor?.createdAt??null}::timestamptz,${cursor?.id??null}::uuid))
   order by created_at desc,id desc limit ${query.limit+1}
  ), page_counts as (
   select p.*,jsonb_array_length(v.content->'entries') as entry_count from page p
   left join client_source_versions v on v.account_id=${scope.accountId} and v.client_id=${scope.clientId} and v.source_id=p.id and v.id=p.version_id
  ) select exists(select 1 from owned) as owned,meta.*,(select count(*)::int from matching) as total,coalesce((select jsonb_agg(p order by p.created_at desc,p.id desc) from page_counts p),'[]'::jsonb) as items from meta
 `
 if(!result?.owned)return null
 if(cursor&&result.epoch!==cursor.epoch)throw new SourceInputError('SOURCE_PAGE_CHANGED')
 const rows=result.items as PageRow[],selected=rows.slice(0,query.limit)
 const items=selected.map(row=>({id:row.id,sourceKey:row.source_key,kind:row.kind,label:row.label,agentUseAllowed:row.agent_use_allowed,revokedAt:row.revoked_at,latestVersion:row.latest_version,updatedAt:row.updated_at,freshness:row.version_id?sourceFreshness(row.imported_at,new Date()):null,current:row.version_id?{id:row.version_id,versionNumber:row.latest_version,contentHash:row.content_hash,importMethod:row.import_method,originRef:row.origin_ref,importedAt:row.imported_at,approvedAt:row.approved_at,approvedBy:row.approved_by,entryCount:row.entry_count}:null}))
 const last=selected.at(-1)
 return{items,total:result.total as number,asOf:result.as_of as string,nextCursor:rows.length>query.limit&&last?encodeSourceCursor({accountId:scope.accountId,clientId:scope.clientId,filter:query.filter,asOf:result.as_of as string,epoch:result.epoch as string|null,createdAt:last.created_at,id:last.id}):null}
}
