import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth:vi.fn(), load:vi.fn(), project:vi.fn() }))
vi.mock('@/lib/db', () => ({db: () => async () => []}))
vi.mock('@/lib/auth', () => ({requireAuth:mocks.auth}))
vi.mock('@/lib/workspace/load-owned-portfolio', () => ({loadOwnedPortfolio:mocks.load}))
vi.mock('@/lib/view-models/portfolio', () => ({buildPortfolio:mocks.project}))
vi.mock('next-intl/server', () => ({getTranslations:async () => (key:string) => key}))
import Page from '@/app/[lang]/dashboard/page'
import { AddBrandWizard } from '@/components/dashboard/AddBrandWizard'
const profile = {account_id:'account-a',accounts:{plan:'basic'}}
beforeEach(() => {vi.clearAllMocks();mocks.auth.mockResolvedValue(profile);mocks.load.mockResolvedValue({});mocks.project.mockReturnValue({clients:[],history:{state:'empty',data:null},capacity:{state:'known',count:0,limit:1,canCreate:true,plan:'basic'}})})
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
it('keeps an authoritative read outage distinct from an empty portfolio',async()=>{
  mocks.load.mockRejectedValue(new Error('private-database-details'))
  const page=await render()
  expect(JSON.stringify(page)).toContain('loadErrorTitle')
  expect(JSON.stringify(page)).not.toContain('private-database-details')
})
