import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({sql:vi.fn()}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({db:()=>m.sql}))
import { readOutcomeInput } from '@/lib/outcomes/store'
import { snapshot } from './snapshot-fixtures'
import { ID, ACTOR_ID, REQUEST_ID, VERSION_ID } from '../delivery/fixtures'
const scope = { accountId: ID, actorId: ACTOR_ID, clientId: REQUEST_ID, itemId: ID, versionId: VERSION_ID }
beforeEach(()=>{m.sql.mockReset(); m.sql.mockResolvedValue([snapshot()])})
it('reads one coherent tagged snapshot with all owned relationships and no writes',async()=>{
 expect(await readOutcomeInput(scope)).toMatchObject({kind:'ok',value:{versionId:VERSION_ID}})
 expect(m.sql).toHaveBeenCalledTimes(1)
 const statement = m.sql.mock.calls[0][0].join('?')
 for(const value of Object.values(scope)) expect(m.sql.mock.calls[0].slice(1)).toContain(value)
 for(const fragment of ['p.account_id =','c.account_id = d.account_id','r.content_hash = v.content_hash','e.content_hash = v.content_hash','e.approval_decision_id','statement_timestamp()','SS.US','LIMIT 201','m.question =','m.platform =','promptId','s.account_id = v.account_id']) expect(statement).toContain(fragment)
 expect(statement).not.toMatch(/INSERT|UPDATE|DELETE|FOR SHARE|clock_timestamp|JOIN prompts|::timestamptz/)
 expect(statement).not.toMatch(/SELECT[^;]*m\.raw_answer,/)
})
it.each([{member:false,owned:false,kind:'denied'},{member:true,owned:false,kind:'not_found'},{member:true,owned:true,kind:'not_found'}])('denies absent scope %j',async({kind,...row})=>{
 m.sql.mockResolvedValue([{...row,version:null}])
 expect(await readOutcomeInput(scope)).toEqual({kind})
 expect(m.sql).toHaveBeenCalledTimes(1)
})
it('fails closed for missing/invalid snapshot, source SQL error, and scope mismatch',async()=>{
 for(const rows of [[],[{}],[{...snapshot(),version:{}}],[{...snapshot(),version:{...snapshot().version,client_id:ID}}]]){
 m.sql.mockResolvedValue(rows); expect(await readOutcomeInput(scope)).toEqual({kind:'unavailable'})
 }
 m.sql.mockRejectedValue(new Error('private details')); expect(await readOutcomeInput(scope)).toEqual({kind:'unavailable'})
})
it('rejects malformed scope without issuing SQL',async()=>{
 expect(await readOutcomeInput({...scope,actorId:'bad'})).toEqual({kind:'unavailable'})
 expect(m.sql).not.toHaveBeenCalled()
})
