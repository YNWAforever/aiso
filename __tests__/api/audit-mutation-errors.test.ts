import {beforeEach,describe,expect,it,vi} from 'vitest'
const mocks=vi.hoisted(()=>({profile:vi.fn(),group:vi.fn(),read:vi.fn(),update:vi.fn(),compare:vi.fn(),start:vi.fn(),wake:vi.fn(),after:vi.fn(),guard:vi.fn(),batch:vi.fn(),apply:vi.fn(),preview:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/auth',()=>({getProfile:mocks.profile}))
vi.mock('next/server',()=>({after:mocks.after}))
vi.mock('@/lib/work-items/group-service',()=>({saveAuthenticatedGroup:mocks.group}))
vi.mock('@/lib/work-items/operations',()=>({readWorkOperations:mocks.read,updateWorkOperations:mocks.update,compareWorkRetest:mocks.compare}))
vi.mock('@/lib/pulse/runs/user-dispatch',async original=>({...await original<typeof import('@/lib/pulse/runs/user-dispatch')>(),startOrResumeUserPulse:mocks.start,wakeUserPulse:mocks.wake}))
vi.mock('@/lib/prompts/guard',()=>({authorizePromptBank:mocks.guard}))
vi.mock('@/lib/prompts/bulk-store',()=>({readPromptBatch:mocks.batch,applyPromptBatch:mocks.apply,previewPromptImport:mocks.preview}))
import * as ops from '@/app/api/clients/[clientId]/work-items/[workItemId]/operations/route'
import * as groups from '@/app/api/clients/[clientId]/work-items/groups/route'
import * as bulk from '@/app/api/dashboard/clients/[clientId]/prompts/bulk/route'
const clientId='11111111-1111-4111-8111-111111111111',workItemId='22222222-2222-4222-8222-222222222222',runId='33333333-3333-4333-8333-333333333333',params=Promise.resolve({clientId,workItemId})
const request=(body:unknown)=>new Request('https://fixture.invalid/api',{method:'POST',body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();mocks.profile.mockResolvedValue({account_id:'owned-account'});mocks.guard.mockResolvedValue({ok:true,accountId:'owned-account'});mocks.read.mockResolvedValue({operationStatus:'done',groupScope:{context:{runId}}});mocks.start.mockResolvedValue({run:{id:runId}});mocks.after.mockImplementation(()=>{})})
describe('audit mutation public error contracts',()=>{
 it.each([['PULSE_QUOTA_EXCEEDED',429],['PULSE_ENTITLEMENT_CHANGED',403],['PULSE_INTENT_CONFLICT',409],['secret postgres credential',503]])('retest %s maps to %i without leaking backend detail',async(code,status)=>{mocks.start.mockRejectedValueOnce(new Error(code));const r=await ops.POST(request({intentKey:'retest-fixture-1'}),{params});expect(r.status).toBe(status);expect((await r.json()).error).toBe(status===503?'WORK_OPERATIONS_UNAVAILABLE':code)})
 it('owned retest persists once and schedules wake after 202',async()=>{const r=await ops.POST(request({intentKey:'retest-fixture-1'}),{params});expect(r.status).toBe(202);expect(mocks.start).toHaveBeenCalledWith({accountId:'owned-account',clientId,itemId:workItemId},{kind:'retest',intentKey:'retest-fixture-1',sourceRunId:runId});expect(mocks.after).toHaveBeenCalledOnce();await mocks.after.mock.calls[0][0]();expect(mocks.wake).toHaveBeenCalledOnce()})
 it('foreign work item returns 404 before any dispatch',async()=>{mocks.read.mockRejectedValueOnce(new Error('WORK_ITEM_NOT_FOUND'));expect((await ops.POST(request({intentKey:'retest-fixture-1'}),{params})).status).toBe(404);expect(mocks.start).not.toHaveBeenCalled()})
 it.each([['operations',ops.PATCH],['groups',groups.POST],['bulk',bulk.POST]] as const)('%s malformed bytes are a client error',async(_name,handler)=>{const r=await handler(new Request('https://fixture.invalid/api',{method:'POST',body:'{'}),{params});expect(r.status).toBe(400)})
 it.each([['operations',ops.PATCH,mocks.update,'WORK_OPERATIONS_UNAVAILABLE'],['groups',groups.POST,mocks.group,'WORK_ITEMS_UNAVAILABLE'],['bulk',bulk.GET,mocks.batch,'PROMPT_BATCH_UNAVAILABLE']] as const)('%s outage is retryable and redacted',async(_name,handler,port,code)=>{port.mockRejectedValueOnce(new Error('postgres://private credential'));const r=await handler(request({}),{params});expect(r.status).toBe(503);expect(await r.json()).toEqual({error:code})})
 it('invalid bulk client is denied before SQL lookup',async()=>{const r=await bulk.GET(request({}),{params:Promise.resolve({clientId:'malformed'})});expect(r.status).toBe(404);expect(mocks.batch).not.toHaveBeenCalled()})
 it('invalid bulk POST client is denied before mutation',async()=>{const r=await bulk.POST(request({mode:'preview',rows:[]}),{params:Promise.resolve({clientId:'malformed'})});expect(r.status).toBe(404);expect(mocks.preview).not.toHaveBeenCalled();expect(mocks.apply).not.toHaveBeenCalled()})
 it('invalid CSV header is 400 and performs no mutation',async()=>{const r=await bulk.POST(request({mode:'preview',csv:'question\nFixture'}),{params});expect(r.status).toBe(400);expect(await r.json()).toEqual({error:'INVALID_CSV_HEADERS'});expect(mocks.apply).not.toHaveBeenCalled()})
})
