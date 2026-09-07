import { beforeEach, expect, it, vi } from 'vitest'
import { decideVersion } from '@/lib/approvals/decision-store'
const m=vi.hoisted(()=>({sql:vi.fn(),transaction:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/db',()=>({db:()=>Object.assign(m.sql,{transaction:m.transaction})}))
const id='11111111-1111-4111-8111-111111111111',input={decision:'approved' as const,reason:' Reason ',requestId:id}
beforeEach(()=>{vi.resetAllMocks();m.sql.mockReturnValue([])})
it.each(['denied','not_found','conflict'])('maps guarded %s',async(kind)=>{m.transaction.mockResolvedValue([[],[],[],[{kind}]]);expect(await decideVersion(id,id,id,id,id,input)).toEqual({kind})})
it('locks profile item state then binds current membership exact active grant latest and independent decision',async()=>{
 m.transaction.mockResolvedValue([[],[],[],[{kind:'conflict'}]])
 await decideVersion(id,id,id,id,id,input)
 const calls=m.sql.mock.calls.map(c=>(c[0] as string[]).join('?'))
 expect(calls[1]).toContain('FOR SHARE');expect(calls[2]).toContain('FOR UPDATE');expect(calls[3]).toContain('account_approver_state');expect(calls[3]).toContain('FOR UPDATE')
 const statement=calls.at(-1)!
 for(const text of ['p.account_id =','current_setting',"e.action = 'grant'",'e.new_revision = s.revision','e.id = s.last_event_id',"submitter->>'profileId'",'max(version_number)','actor_id =','request_id =','reason =','content_hash','grant_revision','grant_event_id'])expect(statement).toContain(text)
 expect(statement.indexOf("THEN 'replayed'")).toBeLessThan(statement.indexOf("THEN 'denied'"))
 expect(m.sql.mock.calls.at(-1)!.slice(1)).toContain('Reason')
})
it('never returns a success after failed write',async()=>{m.transaction.mockRejectedValue(new Error('private'));await expect(decideVersion(id,id,id,id,id,input)).rejects.toThrow('CHANGE_SET_UNAVAILABLE')})

it('normalizes UUID identity before text-based self-decision and lock witnesses',async()=>{
 const upper='ABCDEFAB-1111-4111-8111-111111111111';m.transaction.mockResolvedValue([[],[],[],[{kind:'denied'}]])
 await decideVersion(id,id,id,id,upper,input)
 expect(m.sql.mock.calls.flatMap(c=>c.slice(1))).not.toContain(upper)
})

it.each(['created','replayed'])('returns validated immutable %s terminal record with false capabilities',async(kind)=>{
 const {saved,itemId}=await import('../change-sets/fixtures');const row=await saved()
 const reviewer='22222222-2222-4222-8222-222222222222'
 const terminal={...row,decision_record:{version_id:row.id,content_hash:row.content_hash,actor_id:reviewer,actor:{profileId:reviewer,displayName:'Reviewer',role:'account_approver'},decision:'approved',reason:'Reason',decided_at:'2026-09-07T00:00:00Z'}}
 m.sql.mockReturnValueOnce([{owned:true,versions:[row]}]).mockReturnValue([])
 m.transaction.mockResolvedValue([[],[],[],[{kind,value:terminal}]])
 expect(await decideVersion(id,id,itemId,row.id,reviewer,input)).toMatchObject({kind,value:{decision:{decision:'approved',reason:'Reason'},capabilities:{canDecide:false}}})
 expect(m.sql.mock.calls.at(-1)!.slice(1)).toContain(row.content_hash)
})
it('rejects corrupt retained version before any decision insert',async()=>{
 m.sql.mockReturnValue([{owned:true,versions:[{id}]}]);await expect(decideVersion(id,id,id,id,id,input)).rejects.toThrow('CHANGE_SET_UNAVAILABLE');expect(m.transaction).not.toHaveBeenCalled()
})
it('binds replay to original actor and payload before current grant and latest restrictions',async()=>{
 m.transaction.mockResolvedValue([[],[],[],[{kind:'conflict'}]]);await decideVersion(id,id,id,id,id,input)
 const sql=(m.sql.mock.calls.at(-1)![0] as string[]).join('?')
 const replay=sql.slice(sql.indexOf('replay AS'),sql.indexOf('active_grant AS'))
 expect(replay).toContain('FROM prior WHERE actor_id =');expect(replay).toContain('request_id =');expect(replay).toContain('decision =');expect(replay).toContain('reason =');expect(replay).not.toContain('active_grant');expect(replay).not.toContain('latest')
 expect(sql).toContain('NOT EXISTS (SELECT 1 FROM prior)');expect(sql).toContain('v.version_number = (SELECT number FROM latest)');expect(sql).toContain('v.content_hash =')
})
it('retries only serialization/deadlock failures and never retries a unique terminal conflict',async()=>{
 m.transaction.mockRejectedValueOnce({code:'40P01'}).mockRejectedValueOnce({code:'40001'}).mockResolvedValueOnce([[],[],[],[{kind:'conflict'}]])
 expect(await decideVersion(id,id,id,id,id,input)).toEqual({kind:'conflict'});expect(m.transaction).toHaveBeenCalledTimes(3)
 m.transaction.mockClear().mockRejectedValue({code:'23505'});expect(await decideVersion(id,id,id,id,id,input)).toEqual({kind:'conflict'});expect(m.transaction).toHaveBeenCalledTimes(1)
})
