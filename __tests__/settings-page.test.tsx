import { beforeEach, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({auth:vi.fn(),branding:vi.fn()}))
vi.mock('@/lib/auth',()=>({requireAuth:mocks.auth}))
vi.mock('@/lib/reports/store',()=>({loadReportBranding:mocks.branding}))
vi.mock('next-intl/server',()=>({getTranslations:async()=>(key:string)=>key}))
import Page from '@/app/[lang]/dashboard/settings/page'
const render=()=>Page({params:Promise.resolve({lang:'zh-HK'})})
beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue({account_id:'account-a',accounts:{plan:'free'}});mocks.branding.mockResolvedValue(null)})
it('keeps independent authentication ahead of branding data',async()=>{
 mocks.auth.mockRejectedValue(new Error('AUTH_REDIRECT'))
 await expect(render()).rejects.toThrow('AUTH_REDIRECT');expect(mocks.branding).not.toHaveBeenCalled()
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
