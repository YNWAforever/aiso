import {beforeEach,describe,it,expect,vi} from 'vitest'
vi.mock('server-only',()=>({}))
const mock=vi.hoisted(()=>({profile:vi.fn(),owned:vi.fn(),start:vi.fn(),options:vi.fn(),read:vi.fn(),wake:vi.fn(),after:vi.fn(),repair:vi.fn()}))
vi.mock('@/lib/pulse/runs/legacy-repair',()=>({repairLegacyClassifications:mock.repair}))
vi.mock('@/lib/auth',()=>({getProfile:mock.profile}))
vi.mock('@/lib/db',()=>({db:()=>mock.owned}))
vi.mock('@/lib/pulse/runs/user-dispatch',async original=>({...await original<typeof import('@/lib/pulse/runs/user-dispatch')>(),startOrResumeUserPulse:mock.start,readUserPulseOptions:mock.options,readUserPulseRun:mock.read,wakeUserPulse:mock.wake}))
vi.mock('next/server',async original=>({...await original<typeof import('next/server')>(),after:mock.after}))
import {GET,POST} from '@/app/api/dashboard/clients/[clientId]/pulse-runs/route'
import {GET as detail} from '@/app/api/dashboard/clients/[clientId]/pulse-runs/[runId]/route'
import {POST as repair} from '@/app/api/dashboard/clients/[clientId]/pulse-runs/legacy-repair/route'
const clientId='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222',params={params:Promise.resolve({clientId})}
const request=(body:unknown={kind:'initial',intentKey:'initial-api-1'})=>new Request('http://localhost',{method:'POST',body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('FEATURE_PULSE_ATTEMPTS','1');mock.profile.mockResolvedValue({account_id:'session-account',accounts:{plan:'pro',status:'active',stripe_subscription_id:'sub_fixture'}});mock.owned.mockResolvedValue([{id:clientId}]);mock.start.mockResolvedValue({run:{id:runId},coverage:{status:'queued'}});mock.options.mockResolvedValue({prompts:2,variants:5});mock.read.mockResolvedValue(null)})
describe('authenticated user Pulse runs',()=>{
 it('permits explicit saved-run classification while collection stays disabled',async()=>{
  vi.stubEnv('FEATURE_PULSE_ATTEMPTS','0');mock.repair.mockResolvedValue({classified:1,unchanged:0,failed:0})
  const response=await repair(request({runId,observationIds:[runId],intentKey:'saved-api-repair'}),params)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({classified:1,unchanged:0,failed:0})
  expect(mock.repair).toHaveBeenCalledWith({accountId:'session-account',clientId},expect.objectContaining({runId,observationIds:[runId]}))
  expect(mock.start).not.toHaveBeenCalled();expect(mock.after).not.toHaveBeenCalled()
 })
 it('keeps legacy repair paused and rejects unauthenticated saved repair',async()=>{
  vi.stubEnv('FEATURE_PULSE_ATTEMPTS','0')
  expect((await repair(request({observationIds:[runId],intentKey:'legacy-api-repair'}),params)).status).toBe(503)
  mock.profile.mockResolvedValue(null)
  expect((await repair(request({runId,observationIds:[runId],intentKey:'saved-api-repair'}),params)).status).toBe(401)
  expect(mock.repair).not.toHaveBeenCalled()
 })
 it('does not return repair success over a database failure',async()=>{
  mock.repair.mockRejectedValue(new Error('database incident'))
  expect((await repair(request({runId,observationIds:[runId],intentKey:'saved-api-repair'}),params)).status).toBe(503)
 })
 it('401 has no ownership lookup, persistence or wake',async()=>{mock.profile.mockResolvedValue(null);expect((await POST(request(),params)).status).toBe(401);expect(mock.owned).not.toHaveBeenCalled();expect(mock.start).not.toHaveBeenCalled();expect(mock.after).not.toHaveBeenCalled()})
 it('unentitled calls are rejected before probing ownership',async()=>{mock.profile.mockResolvedValue({account_id:'session-account',accounts:{plan:'free'}});expect((await POST(request(),params)).status).toBe(403);expect(mock.owned).not.toHaveBeenCalled()})
 it('foreign client and foreign run both return 404',async()=>{mock.owned.mockResolvedValue([]);expect((await POST(request(),params)).status).toBe(404);mock.owned.mockResolvedValue([{id:clientId}]);expect((await detail(new Request('http://localhost'),{params:Promise.resolve({clientId,runId})})).status).toBe(404);expect(mock.after).not.toHaveBeenCalled()})
 it('account comes only from session and response follows durable persistence',async()=>{expect((await POST(request({kind:'initial',intentKey:'initial-api-1',accountId:'foreign'}),params)).status).toBe(202);expect(mock.start).toHaveBeenCalledWith({accountId:'session-account',clientId},{kind:'initial',intentKey:'initial-api-1'});expect(mock.after).toHaveBeenCalledTimes(1);expect(mock.start.mock.invocationCallOrder[0]).toBeLessThan(mock.after.mock.invocationCallOrder[0])})
 it.each([['PULSE_CONTEXT_UNCONFIRMED',409],['PULSE_NOT_CONFIGURED',409],['PULSE_QUOTA_EXCEEDED',429],['PULSE_INTENT_CONFLICT',409],['PULSE_RUN_NOT_FOUND',404]])('safe failure %s never wakes worker',async(reason,status)=>{mock.start.mockRejectedValue(new Error(reason));expect((await POST(request(),params)).status).toBe(status);expect(mock.after).not.toHaveBeenCalled()})
 it('GET is read-only and reports storage outage as 503',async()=>{expect((await GET(new Request('http://localhost'),params)).status).toBe(200);expect(mock.start).not.toHaveBeenCalled();expect(mock.after).not.toHaveBeenCalled();mock.owned.mockRejectedValue(new Error('outage'));expect((await GET(new Request('http://localhost'),params)).status).toBe(503)})
 it('flag off fails closed without creating work',async()=>{vi.stubEnv('FEATURE_PULSE_ATTEMPTS','0');expect((await POST(request(),params)).status).toBe(503);expect(mock.start).not.toHaveBeenCalled()})
 it('rejects malformed intent and source IDs',async()=>{expect((await POST(request({kind:'retest',intentKey:'short',sourceRunId:'wrong'}),params)).status).toBe(400);expect(mock.start).not.toHaveBeenCalled()})
})
