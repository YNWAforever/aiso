import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
const h=vi.hoisted(()=>({profile:null as Record<string,unknown>|null,allowed:true,result:'CREATED',query:vi.fn(),set:vi.fn()}))
vi.mock('server-only',()=>({}))
vi.mock('@/lib/auth',()=>({getProfile:async()=>h.profile}))
vi.mock('@/lib/db',()=>({db:()=>async(parts:TemplateStringsArray,...values:unknown[])=>{const sql=parts.join('?');h.query(sql,values);if(sql.includes('enterprise_set_role(')){h.set(values);return[{result:h.result}]}return[{allowed:h.allowed}]}}))
import { POST } from '@/app/api/account/enterprise-roles/route'
import { POST as platformPost } from '@/app/api/admin/accounts/[accountId]/enterprise-roles/route'
const account='11000000-0000-4000-8000-000000000001',foreign='11000000-0000-4000-8000-000000000002',actor='22000000-0000-4000-8000-000000000001',target='22000000-0000-4000-8000-000000000004'
const input={profileId:target,role:'editor',expectedRevision:0,requestId:'55000000-0000-4000-8000-000000000002',reason:'Delegate content editing'}
const request=(body:unknown=input)=>new Request('https://app.example/api/account/enterprise-roles',{method:'POST',body:JSON.stringify(body)})
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('FEATURE_ENTERPRISE_OS','1');h.allowed=true;h.result='CREATED';h.profile={id:actor,account_id:account,is_admin:false,accounts:{plan:'enterprise',status:'active',stripe_subscription_id:'fixture'}}})
afterEach(()=>vi.unstubAllEnvs())
describe('account-scoped role delegation API',()=>{
 it('allows a workspace admin and derives the account and actor solely from their session',async()=>{const response=await POST(request());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toEqual({status:'CREATED'});expect(h.set).toHaveBeenCalledWith([account,actor,target,'editor',0,input.requestId,input.reason])})
 it('denies non-admins before role writes',async()=>{h.allowed=false;expect((await POST(request())).status).toBe(403);expect(h.set).not.toHaveBeenCalled()})
 it.each(['accountId','account_id','actorId','is_admin','actor_authority'])('rejects caller-supplied authority selector %s',async key=>{expect((await POST(request({...input,[key]:foreign}))).status).toBe(400);expect(h.set).not.toHaveBeenCalled()})
 it.each([-1,0.5,2147483647,'1'])('rejects invalid SQL revision %s before writes',async expectedRevision=>{expect((await POST(request({...input,expectedRevision}))).status).toBe(400);expect(h.set).not.toHaveBeenCalled()})
 it('retains foreign-denial from SQL and never substitutes another account',async()=>{h.result='NOT_FOUND';expect((await POST(request({...input,profileId:foreign}))).status).toBe(404);expect(h.set.mock.calls[0][0][0]).toBe(account)})
 it('requires authentication, dark flag and current Enterprise entitlement before SQL',async()=>{h.profile=null;expect((await POST(request())).status).toBe(401);h.profile={id:actor,account_id:account,accounts:{plan:'enterprise',status:'cancelled',stripe_subscription_id:'fixture'}};expect((await POST(request())).status).toBe(403);vi.stubEnv('FEATURE_ENTERPRISE_OS','0');expect((await POST(request())).status).toBe(404);expect(h.query).not.toHaveBeenCalled()})
 it.each([['DENIED',403],['SELF_ROLE_CHANGE_DENIED',403],['ENTITLEMENT_REQUIRED',403],['CONFLICT',409],['INVALID',400]])('rechecks database result %s instead of reporting success',async(result,status)=>{h.result=String(result);expect((await POST(request())).status).toBe(status)})
 it('replays an authorized mutation without issuing another grant',async()=>{h.result='REPLAYED';expect(await(await POST(request())).json()).toEqual({status:'REPLAYED'})})
 it('preserves the platform-admin endpoint and still rejects a workspace admin on that global endpoint',async()=>{expect((await platformPost(request(),{params:Promise.resolve({accountId:foreign})})).status).toBe(403);expect(h.set).not.toHaveBeenCalled();h.profile!.is_admin=true;expect((await platformPost(request(),{params:Promise.resolve({accountId:foreign})})).status).toBe(200);expect(h.set).toHaveBeenCalledWith([foreign,actor,target,'editor',0,input.requestId,input.reason])})
})
