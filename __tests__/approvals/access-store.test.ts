import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listApproverAccess, mutateApproverAccess, parseAccessQuery } from '@/lib/approvals/access-store'
const m = vi.hoisted(() => ({ sql: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/db',()=>({db:()=>Object.assign(m.sql,{transaction:m.transaction})}))
const actor='11111111-1111-4111-8111-111111111111', account='22222222-2222-4222-8222-222222222222', target='33333333-3333-4333-8333-333333333333'
const input={profileId:target,action:'grant' as const,reason:'Reason',expectedRevision:0,requestId:'44444444-4444-4444-8444-444444444444'}
beforeEach(()=>{vi.resetAllMocks(); m.sql.mockReturnValue([{is_admin:true}])})
describe('access store',()=>{
 it('denies before target queries',async()=>{m.sql.mockReturnValue([]);expect(await mutateApproverAccess(actor,account,input)).toEqual({kind:'denied'});expect(m.sql).toHaveBeenCalledTimes(1);expect(m.transaction).not.toHaveBeenCalled()})
 it.each(['denied','not_found','conflict'])('returns post-lock %s without fabricated events',async(kind)=>{m.transaction.mockResolvedValue([[],[],[],[{kind,value:null}]]);expect(await mutateApproverAccess(actor,account,input)).toEqual({kind})})
 it('batches lazy ordered locks and atomic audit/state with current predicates',async()=>{
   m.transaction.mockResolvedValue([[],[],[],[{kind:'created',value:{id:'event'}}]])
   expect(await mutateApproverAccess(actor,account,input)).toEqual({kind:'created',value:{id:'event'}})
   const [queries,options]=m.transaction.mock.calls[0];expect(queries).toHaveLength(4);expect(options).toEqual({isolationLevel:'ReadCommitted'})
   const calls=m.sql.mock.calls.map(c=>(c[0] as string[]).join('?'))
   expect(calls[1]).toContain('FOR SHARE');expect(calls[2]).toContain('FOR UPDATE');expect(calls[3]).toContain('account_approver_state')
   expect(calls[4]).toContain('INSERT INTO account_approver_events');expect(calls[4]).toContain('INSERT INTO account_approver_state');expect(calls[4]).toContain('is_admin IS TRUE');expect(calls[4]).toContain('previous_revision');expect(calls[4]).toContain('rollback_guard')
 })
 it('retries deadlocks twice and propagates audit failure for safe service translation',async()=>{
   m.transaction.mockRejectedValueOnce({code:'40P01'}).mockRejectedValueOnce({code:'40001'}).mockResolvedValue([[],[],[],[{kind:'conflict'}]])
   expect(await mutateApproverAccess(actor,account,input)).toEqual({kind:'conflict'});expect(m.transaction).toHaveBeenCalledTimes(3)
   m.transaction.mockRejectedValue(new Error('audit failed'));await expect(mutateApproverAccess(actor,account,input)).rejects.toThrow('APPROVAL_UNAVAILABLE')
 })
 it('parses independent cursors and rejects unknown or repeated keys',()=>{
   expect(parseAccessQuery(new URLSearchParams('memberCursor='+target))).toEqual({limit:20,memberCursor:target,eventCursor:null})
   expect(()=>parseAccessQuery(new URLSearchParams('unknown=x'))).toThrow('INVALID_APPROVAL_INPUT')
   expect(()=>parseAccessQuery(new URLSearchParams('limit=2&limit=3'))).toThrow()
 })
 it('distinguishes an empty account page from unavailable and guards listing',async()=>{
   m.sql.mockReturnValueOnce([{is_admin:true}]).mockReturnValueOnce([{exists:true}]).mockReturnValueOnce([]).mockReturnValueOnce([])
   expect(await listApproverAccess(actor,account,parseAccessQuery(new URLSearchParams()))).toEqual({kind:'created',value:{members:[],events:[],nextMemberCursor:null,nextEventCursor:null}})
   m.sql.mockImplementation(()=>{throw new Error('secret')});await expect(listApproverAccess(actor,account,parseAccessQuery(new URLSearchParams()))).rejects.toThrow()
 })
})

it('binds writes to profiles actually acquired by ordered lock statements', async () => {
  m.transaction.mockResolvedValue([[],[],[],[{kind:'denied'}]])
  await mutateApproverAccess(actor,account,input)
  const calls=m.sql.mock.calls.map(c=>(c[0] as string[]).join('?'))
  expect(calls[1]).toContain("set_config('aiso.approval_actor_locked'")
  expect(calls[2]).toContain("set_config('aiso.approval_target_locked'")
  expect(calls[1]).toContain("COALESCE((SELECT id::text FROM locked), '')")
  expect(calls[4]).toContain("current_setting('aiso.approval_actor_locked', true)")
  expect(calls[4]).toContain("current_setting('aiso.approval_target_locked', true)")
})
it('paginates member and event lists independently without exposing auth fields', async () => {
  const id='55555555-5555-4555-8555-555555555555'
  const createdAt='2026-09-07T00:00:00.123456Z'
  const eventCursor=Buffer.from(JSON.stringify({createdAt,id})).toString('base64url')
  const query=parseAccessQuery(new URLSearchParams({limit:'1',memberCursor:target,eventCursor}))
  expect(query.eventCursor).toEqual({createdAt,id})
  const e={id,profile_id:target,action:'grant',previous_revision:0,new_revision:1,administrator:{profileId:actor,displayName:'Admin',role:'platform_admin',email:'secret'},reason:'Reason',created_at:createdAt}
  m.sql.mockReturnValueOnce([{}]).mockReturnValueOnce([{}]).mockReturnValueOnce([{id:target,display_name:'Member',revision:1,active:true,email:'secret'},{id}]).mockReturnValueOnce([e,e])
  const result=await listApproverAccess(actor,account,query)
  expect(result).toMatchObject({kind:'created',value:{nextMemberCursor:target,nextEventCursor:eventCursor}})
  expect(JSON.stringify(result)).not.toContain('secret')
  const calls=m.sql.mock.calls
  expect(calls[2].slice(1)).toContain(target); expect(calls[2].slice(1)).not.toContain(createdAt)
  expect(calls[3].slice(1)).toContain(createdAt);expect(calls[3].slice(1)).toContain(id)
  expect((calls[2][0] as string[]).join('?')).toContain('is_admin IS TRUE')
  expect((calls[3][0] as string[]).join('?')).toContain('is_admin IS TRUE')
})
it('checks replay target, normalized reason, expected revision and exact event identity in SQL',async()=>{
 m.transaction.mockResolvedValue([[],[],[],[{kind:'conflict'}]])
 await mutateApproverAccess(actor,account,{...input,reason:'  Re\u0301ason  ',expectedRevision:7})
 const call=m.sql.mock.calls.at(-1)!;const sql=(call[0] as string[]).join('?')
 expect(call.slice(1)).toContain('Réason');expect(call.slice(1)).not.toContain('  Re\u0301ason  ')
 expect(sql).toContain('previous_revision =');expect(sql).toContain('e.administrator_id =');expect(sql).toContain('e.request_id =')
 expect(sql).toContain('e.new_revision = s.revision AND e.id = s.last_event_id')
 expect(sql).toContain("CASE WHEN active THEN 'grant' ELSE 'revoke' END")
 expect(sql).toContain('NOT EXISTS (SELECT 1 FROM replay)')
 expect(sql).toContain('FROM eligible RETURNING *')
 expect(sql).toContain('account_id =')
})

it('never awaits lazy batch queries before transaction and initializes same-profile stronger lock',async()=>{
 const settled=vi.fn()
 const lazy={then:settled}
 m.sql.mockReturnValueOnce([{}]).mockReturnValue(lazy)
 m.transaction.mockResolvedValue([[],[],[{kind:'replayed',value:{id:'retained'}}]])
 expect(await mutateApproverAccess(actor,account,{...input,profileId:actor})).toEqual({kind:'replayed',value:{id:'retained'}})
 expect(settled).not.toHaveBeenCalled()
 expect(m.transaction.mock.calls[0][0]).toEqual([lazy,lazy,lazy])
 const lock=(m.sql.mock.calls[1][0] as string[]).join('?')
 expect(lock).toContain('FOR UPDATE');expect(lock).toContain("set_config('aiso.approval_actor_locked'");expect(lock).toContain("set_config('aiso.approval_target_locked'")
 expect(lock.match(/, true\)/g)).toHaveLength(2)
})
it('orders target-before-actor locks when target UUID sorts first',async()=>{
 m.transaction.mockResolvedValue([[],[],[],[{kind:'conflict'}]])
 await mutateApproverAccess(target,account,{...input,profileId:actor})
 expect(m.sql.mock.calls[1].slice(1)).toEqual([actor])
 expect((m.sql.mock.calls[1][0] as string[]).join('?')).toContain('FOR UPDATE')
 expect(m.sql.mock.calls[2].slice(1)).toEqual([target])
 expect((m.sql.mock.calls[2][0] as string[]).join('?')).toContain('FOR SHARE')
})
it('stops after two retry attempts and maps request-identity uniqueness to conflict',async()=>{
 m.transaction.mockRejectedValue({code:'40001'})
 await expect(mutateApproverAccess(actor,account,input)).rejects.toThrow('APPROVAL_UNAVAILABLE')
 expect(m.transaction).toHaveBeenCalledTimes(3)
 m.transaction.mockClear().mockRejectedValue({code:'23505'})
 expect(await mutateApproverAccess(actor,account,input)).toEqual({kind:'conflict'})
 expect(m.transaction).toHaveBeenCalledTimes(1)
})
