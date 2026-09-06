import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({ profile:vi.fn(), load:vi.fn(), saved:vi.fn() }))
vi.mock('@/lib/auth', () => ({getProfile:mocks.profile}))
vi.mock('@/lib/opportunities/store', () => ({loadOwnedOpportunitySources:mocks.load,loadSavedDraftMapping:mocks.saved}))
import { loadAuthenticatedOpportunities } from '@/lib/opportunities/service'
import { projectObservation } from '@/lib/observations/schema'
const client = '00000000-0000-4000-8000-000000000002'
const id = '00000000-0000-4000-8000-000000000003'
function sourceWindow(pulse='ok',scan='empty') { return { window:{pulseWeek:'2026-08-31',pulseLimit:200,pulseTruncated:false,scanId:null},sourceStates:{pulse,scan},sources:[{kind:'pulse-metric',answerDigest:'a'.repeat(64),observation:projectObservation({id,prompt_id:null,question:'Question?',platform:'chatgpt',scan_week:'2026-08-31',created_at:null,raw_answer:'SECRET',brand_mentioned:false},null)}],evidenceVersions:[{raw_answer:'SECRET TOKEN'}] } }
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); vi.clearAllMocks(); mocks.profile.mockResolvedValue({account_id:'account'}); mocks.saved.mockResolvedValue(new Map()); mocks.load.mockResolvedValue(sourceWindow()) })
it('authenticates before database access even for malformed id', async () => { mocks.profile.mockResolvedValue(null); await expect(loadAuthenticatedOpportunities('bad')).rejects.toMatchObject({code:'UNAUTHENTICATED',status:401}); expect(mocks.load).not.toHaveBeenCalled() })
it('denies missing ownership', async () => { mocks.load.mockResolvedValue(null); await expect(loadAuthenticatedOpportunities(client)).rejects.toMatchObject({status:404}) })
it('reports all failures as 503 and empty plus failure as partial', async () => {
  mocks.load.mockResolvedValue({...sourceWindow('unavailable','unavailable'),sources:[]})
  await expect(loadAuthenticatedOpportunities(client)).rejects.toMatchObject({code:'OPPORTUNITIES_UNAVAILABLE',status:503})
  mocks.load.mockResolvedValue({...sourceWindow('empty','unavailable'),sources:[]})
  expect(await loadAuthenticatedOpportunities(client)).toMatchObject({partial:true,suggestions:[],sourceStates:{pulse:'empty',scan:'unavailable'}})
})
it('maps saved status without leaking internal data', async () => {
  const key = `pulse-brand-absent.v1:pulse-metric:${id}:`
  mocks.saved.mockResolvedValue(new Map([[key,'draft'],['foreign','secret-foreign']]))
  const result = await loadAuthenticatedOpportunities(client)
  expect(result.suggestions[0]).toMatchObject({savedDraftId:'draft',savedState:'saved'})
  expect(Object.keys(result.sourceStates)).toEqual(['pulse','scan'])
  expect(JSON.stringify(result)).not.toMatch(/SECRET|answerDigest|evidenceVersions|raw_answer|secret-foreign/)
})
it('marks saved mapping failure unavailable rather than unsaved', async () => {
  mocks.saved.mockRejectedValue(new Error('SECRET'))
  const result = await loadAuthenticatedOpportunities(client)
  expect(result).toMatchObject({savedDraftsState:'unavailable',partial:true})
  expect(result.suggestions[0]).toMatchObject({savedState:'unavailable',savedDraftId:null})
})
it('orders by source kind, exact source date descending, then source ID', async () => {
  const window = sourceWindow()
  const first = window.sources[0]
  const make = (last:string,time:string|null) => ({...first,observation:{...first.observation,id:`00000000-0000-4000-8000-00000000000${last}`,recordedAt:time}})
  mocks.load.mockResolvedValue({...window,sources:[make('3',null),make('4','2026-09-01T00:00:00.123456Z'),make('5','2026-09-01T00:00:00.123457Z')]})
  const response = await loadAuthenticatedOpportunities(client)
  expect(response.suggestions.map(item => item.source.id.slice(-1))).toEqual(['5','4','3'])
})
it('rejects malformed authenticated IDs without querying and sanitizes lookup failures', async () => {
  await expect(loadAuthenticatedOpportunities('bad')).rejects.toMatchObject({status:400})
  expect(mocks.load).not.toHaveBeenCalled()
  mocks.load.mockRejectedValue(new Error('SECRET SQL password'))
  await expect(loadAuthenticatedOpportunities(client)).rejects.toMatchObject({code:'OPPORTUNITIES_UNAVAILABLE',status:503})
})
it('derives only healthy source groups and records secret-safe diagnostics', async () => {
  mocks.load.mockResolvedValue(sourceWindow('unavailable','empty'))
  const result = await loadAuthenticatedOpportunities(client)
  expect(result.suggestions).toEqual([])
  expect(result.partial).toBe(true)
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/SECRET|password|account/)
})
