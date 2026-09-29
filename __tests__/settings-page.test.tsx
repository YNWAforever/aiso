import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),branding:vi.fn(),members:vi.fn(),connections:vi.fn()}))
// `server-only` is a Next build-time alias with no package to resolve under
// Vitest; stubbing it is the convention the rest of the suite already uses.
vi.mock('server-only',()=>({}))
vi.mock('@/lib/auth',()=>({requireAuth:mocks.auth}))
vi.mock('@/lib/reports/store',()=>({loadReportBranding:mocks.branding}))
vi.mock('@/lib/members/store',()=>({loadAccountMembers:mocks.members}))
vi.mock('@/lib/integrations/search-console/store',()=>({listConnections:mocks.connections}))
vi.mock('next-intl/server',()=>({getTranslations:async()=>(key:string)=>key}))
import Page from '@/app/[lang]/dashboard/settings/page'
import { GoogleConnectionsPanel } from '@/components/integrations/GoogleConnectionsPanel'
const render=()=>Page({params:Promise.resolve({lang:'zh-HK'}),searchParams:Promise.resolve({})})
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({id:'profile-a',account_id:'account-a',accounts:{plan:'free'}});mocks.branding.mockResolvedValue(null);mocks.members.mockResolvedValue({members:[],invitations:[]})})
it('keeps independent authentication ahead of branding data',async()=>{
 mocks.auth.mockRejectedValue(new Error('AUTH_REDIRECT'))
 await expect(render()).rejects.toThrow('AUTH_REDIRECT');expect(mocks.branding).not.toHaveBeenCalled()
 // Same invariant for membership: no session, no read.
 expect(mocks.members).not.toHaveBeenCalled()
})
it('reads membership for the session account, never an id from the URL',async()=>{
 await render();expect(mocks.members).toHaveBeenCalledWith('account-a')
})
it('passes missing status as unknown rather than active',async()=>{
 const page=await render();expect(page.props.status).toBe('unknown');expect(page.props.lang).toBe('zh-HK');expect(mocks.branding).not.toHaveBeenCalled()
})
it.each([
 [{plan:'pro',status:'active',stripe_subscription_id:'sub'},'pro',true],
 [{plan:'enterprise',status:'past_due',stripe_subscription_id:'sub'},'free',false],
 [{plan:'pro',trial_ends_at:'2999-01-01'},'pro',true],
 [{plan:'pro',trial_ends_at:'2000-01-01'},'free',false],
 [{plan:'enterprise',status:'cancelled',override_plan:'basic'},'basic',false],
] as const)('uses the existing resolver and branding gate for %j',async(accounts,plan,branding)=>{
 mocks.auth.mockResolvedValue({account_id:'account-a',accounts})
 const page=await render();expect(page.props.plan).toBe(plan)
 if(branding)expect(mocks.branding).toHaveBeenCalledWith({accountId:'account-a'});else expect(mocks.branding).not.toHaveBeenCalled()
})

describe('Google connections on Settings',()=>{
  const pro={id:'profile-a',account_id:'account-a',accounts:{plan:'pro',status:'active',stripe_subscription_id:'sub'}}
  const panelOf=(page:{props:{children:unknown}})=>[page.props.children].flat(3)
    .find((child):child is {props:Record<string,unknown>}=>Boolean(child)&&(child as {type?:unknown}).type===GoogleConnectionsPanel)
  beforeEach(()=>{process.env.FEATURE_SEARCH_CONSOLE='1';mocks.auth.mockResolvedValue(pro)})
  afterEach(()=>{delete process.env.FEATURE_SEARCH_CONSOLE;vi.restoreAllMocks()})

  it('passes the listed connections through when the read succeeds',async()=>{
    mocks.connections.mockResolvedValue([{id:'g',googleEmail:'o@example.com',status:'active',scopes:[],createdAt:'x'}])
    const panel=panelOf(await render())
    expect(mocks.connections).toHaveBeenCalledWith('account-a')
    expect(panel?.props.loadFailed).toBe(false)
    expect(panel?.props.connections).toHaveLength(1)
  })

  it('keeps the page up when the read fails, and says so in the panel',async()=>{
    const spy=vi.spyOn(console,'error').mockImplementation(()=>{})
    mocks.connections.mockRejectedValue(new Error('relation "google_connections" does not exist postgresql://u:hunter2@h/db'))
    const page=await render()
    const panel=panelOf(page)
    expect(panel?.props.loadFailed).toBe(true)
    expect(panel?.props.connections).toEqual([])
    // Only the error's name is logged: the Neon driver can echo the connection string.
    expect(spy).toHaveBeenCalledWith(expect.any(String),{name:'Error'})
    expect(JSON.stringify(spy.mock.calls)).not.toContain('hunter2')
    // The rest of the page still renders.
    expect(mocks.members).toHaveBeenCalledWith('account-a')
  })
})
