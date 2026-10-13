import {beforeEach,expect,it,vi}from'vitest'
import{createHash}from'node:crypto'
const state=vi.hoisted(()=>({sql:vi.fn(),transaction:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/db',()=>({db:()=>Object.assign(state.sql,{transaction:state.transaction})}))
import{applyPromptBatch}from'@/lib/prompts/bulk-store'
beforeEach(()=>vi.clearAllMocks())
it('keeps an existing unfinished receipt unknown and does not perform another write',async()=>{
 const scope={accountId:'synthetic-account',clientId:'11111111-1111-4111-8111-111111111111'}
 const input={intentKey:'pending-batch-01',expectedVersion:'a'.repeat(32),changes:[{question:'Synthetic question',category:'brand_query',language:'en',market:'HK',is_active:true}]}
 const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex')
 state.sql.mockResolvedValueOnce([{request_hash:hash,result:null}])
 await expect(applyPromptBatch(scope,input)).rejects.toThrow('PROMPT_BATCH_PENDING')
 expect(state.transaction).not.toHaveBeenCalled()
})
