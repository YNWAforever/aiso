import { describe,expect,it,vi } from 'vitest'
vi.mock('server-only',()=>({}))
import { runVisibilityRevalidations } from '@/lib/visibility/cron'
const target={account_id:'account',client_id:'client',domain:'example.com',plan:'pro',status:'active',stripe_subscription_id:'fixture'}
function ports(){return{repair:vi.fn(async()=>0),targets:vi.fn(async()=>[target]),sources:vi.fn(async()=>[{id:'bad',kind:'deployment'},{id:'good',kind:'deployment'}]),enqueue:vi.fn(async()=>({id:'job',status:'queued'})),touch:vi.fn(async()=>{}),due:vi.fn(async()=>[{id:'bad-job',account_id:'a',client_id:'c',status:'queued'},{id:'good-job',account_id:'a',client_id:'c',status:'queued'},{id:'waiting',account_id:'a',client_id:'c',status:'waiting'}]),claim:vi.fn(async()=>({id:'lease'} as never)),process:vi.fn(async()=>{}),poll:vi.fn(async()=>true),baseline:vi.fn(async()=>1)}}
describe('visibility cron independent work',()=>{
 it('continues later sources, jobs, polls and baselines after an enqueue or lease failure',async()=>{const deps=ports();deps.enqueue.mockRejectedValueOnce(new Error('VISIBILITY_NOT_FOUND'));deps.process.mockRejectedValueOnce(new Error('VISIBILITY_LEASE_LOST'));const result=await runVisibilityRevalidations(Date.now()+45000,deps);expect(result).toMatchObject({queued:1,processed:2,baselines:1,deferred:2});expect(deps.enqueue).toHaveBeenCalledTimes(2);expect(deps.process).toHaveBeenCalledTimes(2);expect(deps.poll).toHaveBeenCalledTimes(1);expect(deps.baseline).toHaveBeenCalledTimes(1);expect(deps.touch).toHaveBeenCalledTimes(1)})
})
