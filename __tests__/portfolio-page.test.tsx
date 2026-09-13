import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  auth:vi.fn(), load:vi.fn(), project:vi.fn(),
  activation:vi.fn(), cookie:vi.fn(), verifyIntent:vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({db: () => async () => []}))
vi.mock('@/lib/auth', () => ({requireAuth:mocks.auth}))
vi.mock('@/lib/workspace/load-owned-portfolio', () => ({loadOwnedPortfolio:mocks.load}))
vi.mock('@/lib/view-models/portfolio', () => ({buildPortfolio:mocks.project}))
vi.mock('next-intl/server', () => ({getTranslations:async () => (key:string) => key}))
vi.mock('@/lib/telemetry/activation', async () => ({
  ...(await vi.importActual<typeof import('@/lib/telemetry/activation')>('@/lib/telemetry/activation')),
  readActivation: mocks.activation,
}))
vi.mock('next/headers', () => ({cookies: async () => ({get: mocks.cookie})}))
vi.mock('@/lib/security/scan-claim-intent', async () => ({
  ...(await vi.importActual<typeof import('@/lib/security/scan-claim-intent')>('@/lib/security/scan-claim-intent')),
  verifyScanClaimIntent: mocks.verifyIntent,
}))
import Page from '@/app/[lang]/dashboard/page'
import { AddBrandWizard } from '@/components/dashboard/AddBrandWizard'
const profile = {account_id:'account-a',accounts:{plan:'basic'}}
const activation = {accountId:'account-a',observedAt:'2026-09-09T00:00:00.000Z',furthest:'first_scan',
  reached:{first_scan:'2026-09-01T00:00:00.000Z',first_workspace:null,first_source:null,first_approved_work:null,first_export:null,first_declared_delivery:null}}
beforeEach(() => {vi.clearAllMocks();mocks.auth.mockResolvedValue(profile);mocks.load.mockResolvedValue({});mocks.project.mockReturnValue({clients:[],history:{state:'empty',data:null},capacity:{state:'known',count:0,limit:1,canCreate:true,plan:'basic'}});mocks.activation.mockResolvedValue(activation);mocks.cookie.mockReturnValue(undefined);mocks.verifyIntent.mockReturnValue(null)})
const render=()=>Page({params:Promise.resolve({lang:'en'})})
it('requires page authentication before loading tenant data',async()=>{
  mocks.auth.mockRejectedValue(new Error('AUTH_REDIRECT'))
  await expect(render()).rejects.toThrow('AUTH_REDIRECT')
  expect(mocks.load).not.toHaveBeenCalled()
})
it('uses all-owned capacity and retains the existing creation component only when allowed',async()=>{
  const page=await render()
  expect(mocks.load).toHaveBeenCalledWith({profile})
  expect(page.props.creationControl.type).toBe(AddBrandWizard)
  expect(page.props.creationControl.props.lang).toBe('en')
})
it.each([{state:'unknown',canCreate:null,count:null},{state:'known',canCreate:false,count:1}])('does not expose creation for %j',async capacity=>{
  mocks.project.mockReturnValue({clients:[],history:{state:'empty',data:null},capacity:{...capacity,limit:1,plan:'basic'}})
  const page=await render()
  expect(page.props.creationControl).toBeNull()
})
it('gives the derived activation funnel its first reader',async()=>{
  const page=await render()
  expect(mocks.activation).toHaveBeenCalledWith('account-a')
  expect(page.props.activation.state).toBe('ready')
  expect(page.props.activation.reached).toBe(1)
})
it('reports activation as unavailable when the read fails, and still serves the portfolio',async()=>{
  // readActivation throws rather than returning nulls so an incident cannot be
  // mistaken for an account that did nothing. The page must not undo that by
  // failing the whole screen, nor by rendering a zero.
  mocks.activation.mockRejectedValue(new Error('private-database-details'))
  const page=await render()
  expect(page.props.activation).toEqual({state:'unavailable'})
  expect(JSON.stringify(page)).not.toContain('private-database-details')
})
it('carries the pending claim intent so onboarding can claim that scan',async()=>{
  mocks.cookie.mockReturnValue({value:'signed-token'})
  mocks.verifyIntent.mockReturnValue({scanId:'scan-xyz',lang:'en',returnPath:'/en',attemptId:'a',exp:1})
  const page=await render()
  expect(mocks.verifyIntent).toHaveBeenCalledWith('signed-token')
  expect(page.props.firstRunScanId).toBe('scan-xyz')
})
it('passes no scan when the intent cookie is absent or unverifiable',async()=>{
  mocks.cookie.mockReturnValue({value:'tampered'})
  mocks.verifyIntent.mockReturnValue(null)
  const page=await render()
  expect(page.props.firstRunScanId).toBeNull()
})
it('keeps an authoritative read outage distinct from an empty portfolio',async()=>{
  mocks.load.mockRejectedValue(new Error('private-database-details'))
  const page=await render()
  expect(JSON.stringify(page)).toContain('loadErrorTitle')
  expect(JSON.stringify(page)).not.toContain('private-database-details')
})
