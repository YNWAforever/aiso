import { expect, it, vi } from 'vitest'
vi.mock('server-only',()=>({}))
const {sql}=vi.hoisted(()=>({sql:vi.fn()}))
vi.mock('@/lib/db',()=>({db:()=>sql}))
import { listSources } from '@/lib/sources/store'
import { parseSourceQuery,encodeSourceCursor } from '@/lib/sources/query'
it('all_201_sources_are_reachable',async()=>{
 const rows=Array.from({length:201},(_,i)=>({id:`source-${i}`,source_key:`key-${i}`,kind:'facts',label:'Fixture',agent_use_allowed:false,revoked_at:null,latest_version:0,updated_at:'2026-09-02T00:00:00Z',version_id:null,version_number:null,content_hash:null,import_method:null,origin_ref:null,imported_at:null,approved_at:null,content:null}))
 sql.mockImplementation(async(strings:TemplateStringsArray)=>strings.join('').includes('limit 200')?rows.slice(0,200):rows)
 expect(await listSources({accountId:'a',clientId:'c',actorId:'actor'})).toHaveLength(201)
})
it('binds the cursor to account, client and filter with bounded page sizes',()=>{
 const cursor=encodeSourceCursor({accountId:'a',clientId:'c',filter:'all',asOf:'2026-09-02T00:00:00.123456Z',epoch:null,createdAt:'2026-09-01T00:00:00Z',id:'00000000-0000-4000-8000-000000000001'})
 expect(parseSourceQuery(new URLSearchParams({cursor}),'a','c').cursor?.createdAt).toBe('2026-09-01T00:00:00Z')
 for(const params of [new URLSearchParams({cursor}),new URLSearchParams({cursor,filter:'revoked'}),new URLSearchParams('limit=101'),new URLSearchParams('filter=all&filter=all')])expect(()=>parseSourceQuery(params,'b','c')).toThrow()
 expect(parseSourceQuery(new URLSearchParams(),'a','c')).toMatchObject({limit:50,filter:'all',cursor:null})
})
