import type { SourceSummary } from '@/lib/sources/pagination'
import { buildSourcePack } from '@/lib/view-models/source-pack'
export const sourceClientId='11111111-1111-4111-8111-111111111111'
export const sourceRows:SourceSummary[]=Array.from({length:201},(_,index)=>({id:`00000000-0000-4000-8000-${(index+1).toString().padStart(12,'0')}`,sourceKey:`source-${index}`,kind:'facts',label:`Source ${index+1}`,agentUseAllowed:false,revokedAt:null,latestVersion:0,freshness:null,updatedAt:'2026-09-02T00:00:00Z',current:null}))
export function sourcePageFixture(offset=0,filter='all'){
 const rows=filter==='revoked'?[]:sourceRows.slice(offset,offset+50)
 return{items:rows,sources:rows,pack:buildSourcePack(rows),total:filter==='revoked'?0:201,asOf:'2026-09-02T00:00:00Z',nextCursor:offset+50<201&&filter!=='revoked'?`page-${offset+50}`:null}
}
