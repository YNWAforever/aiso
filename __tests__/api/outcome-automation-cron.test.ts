import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
const h=vi.hoisted(()=>({flags:[] as string[],outcomes:vi.fn(),visibility:vi.fn(),enterprise:vi.fn(),start:vi.fn(),finish:vi.fn()}))
vi.mock('@/lib/flags',()=>({isFeatureEnabled:(flag:string)=>h.flags.includes(flag)}))
vi.mock('@/lib/outcome-integrations/evaluate',()=>({runOutcomeEvaluations:h.outcomes}))
vi.mock('@/lib/visibility/cron',()=>({runVisibilityRevalidations:h.visibility}))
vi.mock('@/lib/enterprise/cron',()=>({runEnterpriseAutomation:h.enterprise}))
vi.mock('@/lib/cron/recordRun',()=>({startCronRun:h.start,finishCronRun:h.finish}))
import { GET } from '@/app/api/cron/outcomes/route'
const request=()=>new Request('https://app.example/api/cron/outcomes',{headers:{authorization:'Bearer test-cron-secret-long'}})
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('CRON_SECRET','test-cron-secret-long');h.flags=[];h.start.mockResolvedValue('run');h.outcomes.mockResolvedValue({evaluated:1,deferred:0});h.visibility.mockResolvedValue({processed:1,deferred:0});h.enterprise.mockResolvedValue({reports:1,deferred:0})})
afterEach(()=>vi.unstubAllEnvs())
describe('independent daily outcome automation',()=>{
 it('authenticates before any automation work',async()=>{
  expect((await GET(new Request('https://app.example/api/cron/outcomes'))).status).toBe(401)
  expect(h.start).not.toHaveBeenCalled();expect(h.visibility).not.toHaveBeenCalled()
 })
 it.each(['outcome_integrations','closed_loop_visibility','enterprise_os'])('supports %s independently without activating the other feature',async flag=>{
  h.flags=[flag];expect((await GET(request())).status).toBe(200)
  expect(h.outcomes).toHaveBeenCalledTimes(flag==='outcome_integrations'?1:0)
  expect(h.visibility).toHaveBeenCalledTimes(flag==='closed_loop_visibility'?1:0)
  expect(h.enterprise).toHaveBeenCalledTimes(flag==='enterprise_os'?1:0)
 })
 it('finishes independent work and retains a loud safe failure when one worker rejects',async()=>{
  h.flags=['outcome_integrations','closed_loop_visibility','enterprise_os'];h.outcomes.mockRejectedValue(new Error('secret provider prompt'))
  const response=await GET(request());expect(response.status).toBe(503)
  expect(h.visibility).toHaveBeenCalledOnce();expect(h.enterprise).toHaveBeenCalledOnce();expect(h.finish).toHaveBeenCalledWith('run','error',expect.anything(),'AUTOMATION_UNAVAILABLE')
  expect(await response.text()).not.toContain('secret provider prompt')
 })
 it('surfaces deferred work as incomplete rather than silent success',async()=>{
  h.flags=['closed_loop_visibility'];h.visibility.mockResolvedValue({processed:1,deferred:2})
  expect((await GET(request())).status).toBe(502)
 })
})
