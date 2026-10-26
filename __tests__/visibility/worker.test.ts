import { describe,expect,it,vi } from 'vitest'
vi.mock('server-only',()=>({}))
vi.mock('@/lib/db',()=>({db:vi.fn()}))
vi.mock('@/lib/visibility/jobs',()=>({finishVisibilityJob:vi.fn(),saveVisibilityPageSnapshot:vi.fn()}))
vi.mock('@/lib/pulse/runs/user-dispatch',()=>({startOrResumeUserPulse:vi.fn(),readUserPulseRun:vi.fn()}))
import { processVisibilityJob } from '@/lib/visibility/worker'
import type { VisibilityJobLease } from '@/lib/visibility/jobs'
const lease:VisibilityJobLease={accountId:'account',clientId:'client',id:'job',token:'token',attempt:1,domain:'example.com',urls:['https://example.com/a'],baseline:{pages:[]},sourceRunId:'source',retestRunId:null,requestedBy:'member',sourceAt:'2026-10-25T00:00:00Z'}
function ports(){return{authorize:vi.fn(async()=>({allowed:true,reason:'AUTHORIZED',domain:'example.com'})),check:vi.fn(async()=>({url:'https://example.com/a',observedAt:'2026-10-26T00:00:00Z',method:'visibility-page.v1' as const,collection:'complete' as const,httpStatus:200,canonicalState:'missing' as const,noindex:false,titlePresent:true,contentHash:'a'.repeat(64),limitations:[]})),snapshot:vi.fn(async()=>({id:'snapshot'})),start:vi.fn(async()=>({run:{id:'retest'}})),finish:vi.fn(async()=>true)}}
describe('durable closed-loop worker',()=>{
 it('reserves an idempotent frozen-manifest retest and waits without calling a provider',async()=>{
  const deps=ports();await processVisibilityJob(lease,Date.now()+45000,deps)
  expect(deps.start).toHaveBeenCalledWith({accountId:'account',clientId:'client'},{kind:'retest',intentKey:'closed-loop:job',sourceRunId:'source'})
  expect(deps.finish).toHaveBeenCalledWith(lease,'waiting','PULSE_PENDING',expect.objectContaining({pages:expect.any(Array)}),'retest')
 })
 it('blocks a removed creator or lost entitlement before fetch or reservation',async()=>{
  const deps=ports();deps.authorize.mockResolvedValue({allowed:false,reason:'AUTHORIZATION_CHANGED',domain:'example.com'})
  await processVisibilityJob(lease,Date.now()+45000,deps)
  expect(deps.check).not.toHaveBeenCalled();expect(deps.start).not.toHaveBeenCalled()
  expect(deps.finish).toHaveBeenCalledWith(lease,'blocked','AUTHORIZATION_CHANGED',{},null)
 })
 it('records missing AI baselines honestly and still retains page checks',async()=>{
  const deps=ports();await processVisibilityJob({...lease,sourceRunId:null},Date.now()+45000,deps)
  expect(deps.start).not.toHaveBeenCalled()
  expect(deps.finish).toHaveBeenCalledWith(expect.anything(),'completed','AI_BASELINE_UNAVAILABLE',expect.objectContaining({ai:{comparable:false,reasons:['AI_BASELINE_UNAVAILABLE']}}),null)
 })
 it('refuses foreign URLs after a domain change before outbound work',async()=>{
  const deps=ports();await processVisibilityJob({...lease,urls:['https://foreign.example/a']},Date.now()+45000,deps)
  expect(deps.check).not.toHaveBeenCalled();expect(deps.start).not.toHaveBeenCalled()
  expect(deps.finish).toHaveBeenCalledWith({...lease,urls:['https://foreign.example/a']},'blocked','TARGET_URL_UNSUPPORTED',{},null)
 })
})
