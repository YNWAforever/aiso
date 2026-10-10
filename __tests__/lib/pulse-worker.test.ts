import {describe,it,expect,vi,afterEach} from 'vitest'
vi.mock('server-only',()=>({}))
const persistence=vi.hoisted(()=>({commit:vi.fn(async()=> 'committed' as const),classification:vi.fn()}))
vi.mock('@/lib/pulse/runs/store',async original=>({...await original<typeof import('@/lib/pulse/runs/store')>(),commitAttempt:persistence.commit,recordClassification:persistence.classification}))
import {consumeDuePulseWork,type PulseWorkerPorts} from '@/lib/pulse/runs/worker'
import {processLeasedItem} from '@/lib/pulse/runs/service'
import {coverageFromCounts,type LeasedItem} from '@/lib/pulse/runs/schema'
import type {DueRun} from '@/lib/pulse/runs/queue'
const run=(id='old-run'):DueRun=>({id,accountId:'synthetic-account',clientId:'synthetic-client',scanWeek:'2026-09-28',allowedPlatforms:['gemini-flash']})
const item=(id='item'):LeasedItem=>({...run(),id,runId:'old-run',token:'token',fence:1,attempt:1,attemptId:'attempt',platform:'gemini-flash',model:'google/gemini-3.8-flash',snapshot:{question:'Synthetic?',language:'zh-HK',market:'HK',category:'brand_query'},brand:{name:'Synthetic',competitors:[],industry:null}})
function ports(){
  let clock=0
  const p:PulseWorkerPorts={now:()=>clock,initialize:vi.fn(async()=>({runs:[],exhausted:true,failures:0})),
    page:vi.fn(async()=>({runs:[run()],cursor:null,exhausted:true})),unblock:vi.fn(async()=>{}),
    claim:vi.fn(async()=>[]),process:vi.fn(async()=> 'committed'),block:vi.fn(async()=> 'committed'),
    coverage:vi.fn(async()=>coverageFromCounts({expected:1,succeeded:1,failed:0,pending:0,blocked:0,classified:1,mentioned:0})),
    summarize:vi.fn(async()=>{}),due:vi.fn(async()=>false)}
  return {p,setClock:(next:number)=>{clock=next}}
}
afterEach(()=>vi.useRealTimers())
describe('T07 durable Pulse consumer',()=>{
  it('raw completion with unknown classification remains partial',async()=>{
    const {p}=ports();p.coverage=vi.fn(async()=>coverageFromCounts({expected:1,succeeded:1,failed:0,pending:0,blocked:0,classified:0,mentioned:0}))
    expect(await consumeDuePulseWork({mode:'repair',owner:'repair',deadlineAt:45_000},p)).toMatchObject({outcome:'partial',unclassified:1})
  })
  it('repair resumes original run/week without starting a daily manifest',async()=>{
    const {p}=ports()
    expect(await consumeDuePulseWork({mode:'repair',owner:'repair',deadlineAt:45_000},p)).toMatchObject({outcome:'complete',runIds:['old-run']})
    expect(p.initialize).not.toHaveBeenCalled()
    expect(p.summarize).toHaveBeenCalledWith(expect.objectContaining({scanWeek:'2026-09-28'}))
  })
  it('bad_client_does_not_block_next',async()=>{
    const {p}=ports();p.page=vi.fn(async()=>({runs:[run('bad'),run('good')],cursor:null,exhausted:true}))
    p.claim=vi.fn(async target=>{if(target.id==='bad')throw new Error('Synthetic broken client');return []})
    const result=await consumeDuePulseWork({mode:'repair',owner:'repair',deadlineAt:45_000},p)
    expect(result).toMatchObject({outcome:'partial',errors:1,runIds:['bad','good']})
    expect(p.summarize).toHaveBeenCalledWith(expect.objectContaining({id:'good'}))
  })
  it('interrupted_after_budget_resumes_original_week and stops opening new items',async()=>{
    const {p,setClock}=ports()
    p.claim=vi.fn(async()=>[item()]);p.process=vi.fn(async()=>{setClock(39_000);return 'committed'})
    p.coverage=vi.fn(async()=>coverageFromCounts({expected:2,succeeded:1,failed:0,pending:1,blocked:0,classified:0,mentioned:0}))
    p.due=vi.fn(async()=>true)
    const first=await consumeDuePulseWork({mode:'repair',owner:'first',deadlineAt:45_000},p)
    expect(first).toMatchObject({outcome:'partial',processed:1,remaining:1,hasDue:true})
    expect(p.claim).toHaveBeenCalledTimes(1)
    expect(p.summarize).not.toHaveBeenCalled()
    const resumed=ports();expect((await consumeDuePulseWork({mode:'repair',owner:'second',deadlineAt:45_000},resumed.p)).runIds).toEqual(['old-run'])
  })
  it('keeps backoff pending and only accelerates items actually due',async()=>{
    const {p}=ports();p.coverage=vi.fn(async()=>coverageFromCounts({expected:1,succeeded:0,failed:0,pending:1,blocked:0,classified:0,mentioned:0}))
    expect(await consumeDuePulseWork({mode:'repair',owner:'repair',deadlineAt:45_000},p)).toMatchObject({outcome:'partial',remaining:1,hasDue:false})
  })
  it('does not spend on variants no longer commercially allowed',async()=>{
    const {p}=ports();p.page=vi.fn(async()=>({runs:[{...run(),allowedPlatforms:[]}],cursor:null,exhausted:true}))
    p.claim=vi.fn().mockResolvedValueOnce([item()]).mockResolvedValue([])
    p.coverage=vi.fn(async()=>coverageFromCounts({expected:1,succeeded:0,failed:0,pending:0,blocked:1,classified:0,mentioned:0}))
    expect((await consumeDuePulseWork({mode:'repair',owner:'repair',deadlineAt:45_000},p)).outcome).toBe('blocked')
    expect(p.block).toHaveBeenCalledTimes(1);expect(p.process).not.toHaveBeenCalled()
  })
  it('reports unfinished candidate traversal as partial with a saved cursor',async()=>{
    const {p}=ports();p.initialize=vi.fn(async()=>({runs:[],exhausted:false,failures:0,enqueue:{scanWeek:'2026-09-28',after:{createdAt:'2026-09-01T00:00:00Z',clientId:'candidate'},failedClientIds:[],complete:false}}))
    const result=await consumeDuePulseWork({mode:'weekly',owner:'weekly',deadlineAt:45_000},p)
    expect(result).toMatchObject({outcome:'partial',hasDue:true,enqueue:{complete:false,scanWeek:'2026-09-28'}})
  })
  it('persists timeout before a slow45s collector that ignores abort can finish',async()=>{
    vi.useFakeTimers();vi.setSystemTime(0);persistence.commit.mockClear()
    const operation=processLeasedItem(item(),45_000,async()=>new Promise(resolve=>setTimeout(()=>resolve({answer:'Late',actualModel:null,requestId:null,promptTokens:null,completionTokens:null,costUsd:null,httpStatus:200}),45_000)))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await operation).toBe('committed')
    expect(persistence.commit).toHaveBeenCalledWith(expect.anything(),{kind:'failed',errorCode:'PROVIDER_TIMEOUT_OUTCOME_UNKNOWN'})
    await vi.advanceTimersByTimeAsync(15_000)
    expect(persistence.commit).toHaveBeenCalledTimes(1)
  })
})
