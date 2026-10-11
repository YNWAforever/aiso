import {beforeEach,describe,it,expect,vi} from 'vitest'
import {NextRequest} from 'next/server'
const m=vi.hoisted(()=>({profile:vi.fn(),complete:vi.fn()}))
vi.mock('@/lib/auth',()=>({getProfile:m.profile}));vi.mock('@/lib/onboarding/service',()=>({completeOnboarding:m.complete}))
import {POST} from '@/app/api/dashboard/clients/route'
const request=(body:unknown)=>new NextRequest('https://fixture.test/api/dashboard/clients',{method:'POST',body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();m.profile.mockResolvedValue({account_id:'account-a',accounts:{plan:'pro',status:'active',stripe_subscription_id:'synthetic'}});m.complete.mockResolvedValue({clientId:'client-a',progress:{prompts:'pending'}})})
describe('durable brand compatibility adapter',()=>{
 it('uses the shared service and ignores body tenant',async()=>{const r=await POST(request({brand_name:'Acme',intentKey:'intent',account_id:'foreign'}));expect(r.status).toBe(200);expect(await r.json()).toMatchObject({id:'client-a',progress:{prompts:'pending'}});expect(m.complete).toHaveBeenCalledWith({accountId:'account-a'},expect.objectContaining({brandName:'Acme',language:null}))})
 it.each([{},null,[],{brand_name:' '},{brand_name:'Acme',domain:42},{brand_name:'x'.repeat(161)}])('denies invalid input before service %j',async body=>{expect((await POST(request(body))).status).toBe(400);expect(m.complete).not.toHaveBeenCalled()})
 it('denies malformed JSON before service',async()=>{expect((await POST(new NextRequest('https://fixture.test',{method:'POST',body:'{'}))).status).toBe(400);expect(m.complete).not.toHaveBeenCalled()})
 it('denies anonymous users',async()=>{m.profile.mockResolvedValue(null);expect((await POST(request({brand_name:'Acme'}))).status).toBe(401);expect(m.complete).not.toHaveBeenCalled()})
 it('retains trigger quota and entitlement errors',async()=>{m.complete.mockRejectedValue(new Error('BRAND_LIMIT_REACHED'));const r=await POST(request({brand_name:'Acme'}));expect(r.status).toBe(403);expect(await r.json()).toMatchObject({limit:3,plan:'pro'});m.complete.mockRejectedValue(new Error('ACCOUNT_ENTITLEMENT_INVALID'));expect((await POST(request({brand_name:'Acme'}))).status).toBe(409)})
 it('distinguishes payload conflicts from tenancy denial',async()=>{m.complete.mockRejectedValue(new Error('ONBOARDING_INTENT_CONFLICT'));expect((await POST(request({brand_name:'Acme',intentKey:'intent'}))).status).toBe(409);m.complete.mockResolvedValue(null);expect((await POST(request({brand_name:'Acme',clientId:'11111111-1111-4111-8111-111111111111'}))).status).toBe(404)})
})
