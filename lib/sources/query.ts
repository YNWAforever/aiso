import { SourceInputError } from './schema'
export type SourceFilter='all'|'awaiting-approval'|'in-use'|'revoked'
export type SourceCursor={accountId:string;clientId:string;filter:SourceFilter;asOf:string;epoch:string|null;createdAt:string;id:string}
export type SourceQuery={filter:SourceFilter;limit:number;cursor:SourceCursor|null}
const filters=['all','awaiting-approval','in-use','revoked'] as const
const timestamp=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value)&&Number.isFinite(Date.parse(value))
const invalid=():never=>{throw new SourceInputError('SOURCE_QUERY_INVALID')}
export function encodeSourceCursor(cursor:SourceCursor){return Buffer.from(JSON.stringify(cursor)).toString('base64url')}
export function parseSourceQuery(params:URLSearchParams,accountId:string,clientId:string):SourceQuery{
 const seen=new Set<string>()
 for(const key of params.keys()){if(!['filter','limit','cursor'].includes(key)||seen.has(key))invalid();seen.add(key)}
 const filter=params.get('filter')??'all'
 if(!filters.includes(filter as SourceFilter))invalid()
 const rawLimit=params.get('limit')??'50'
 if(!/^[1-9]\d?$|^100$/.test(rawLimit))invalid()
 let cursor:SourceCursor|null=null
 const raw=params.get('cursor')
 if(raw!==null){
  if(raw.length>2048||!raw.length||!/^[A-Za-z0-9_-]+$/.test(raw))invalid()
  try{const bytes=Buffer.from(raw,'base64url');if(bytes.toString('base64url')!==raw)invalid();cursor=JSON.parse(bytes.toString('utf8'))}catch{invalid()}
  if(!cursor||Object.keys(cursor).sort().join(',')!=='accountId,asOf,clientId,createdAt,epoch,filter,id'||cursor.accountId!==accountId||cursor.clientId!==clientId||cursor.filter!==filter||!timestamp(cursor.asOf)||!timestamp(cursor.createdAt)||(cursor.epoch!==null&&!timestamp(cursor.epoch))||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(cursor.id))invalid()
 }
 return{filter:filter as SourceFilter,limit:Number(rawLimit),cursor}
}
