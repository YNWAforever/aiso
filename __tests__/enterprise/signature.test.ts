import { afterEach,describe,expect,it,vi } from 'vitest'
vi.mock('server-only',()=>({}))
import { signEnterpriseRequest,verifyEnterpriseRequest,signPortalLink,verifyPortalLink,signEnterpriseWebhook } from '@/lib/enterprise/signature'
const request={timestamp:String(Math.floor(Date.now()/1000)),nonce:'11000000-0000-4000-8000-000000000001',method:'POST',path:'/api/v1/clients/client/adapters/results',body:' {"answer":"香港"}\n'}
afterEach(()=>vi.unstubAllEnvs())
describe('versioned enterprise signatures',()=>{
 it('binds timestamp, nonce, method, path/query and exact bounded body',()=>{
  const signature=signEnterpriseRequest('secret',request)
  expect(verifyEnterpriseRequest('secret',request,signature)).toBe(true)
  for(const change of [{method:'GET'},{path:request.path+'?account=foreign'},{body:request.body.trim()},{nonce:'11000000-0000-4000-8000-000000000002'},{timestamp:'1000000000'}])expect(verifyEnterpriseRequest('secret',{...request,...change},signature)).toBe(false)
 })
 it('uses a separate signing domain for webhook deliveries',()=>{
  expect(verifyEnterpriseRequest('secret',request,signEnterpriseWebhook('secret',request.timestamp,request.body))).toBe(false)
 })
 it('binds revocable portal links to slug, version and locale and fails closed without a strong key',()=>{
  vi.stubEnv('REPORT_SHARE_SECRET','s'.repeat(40))
  const input={slug:'a'.repeat(32),version:1,locale:'en' as const},signature=signPortalLink(input)
  expect(verifyPortalLink({...input,signature})).toBe(true)
  expect(verifyPortalLink({...input,version:2,signature})).toBe(false)
  expect(verifyPortalLink({...input,locale:'zh-HK',signature})).toBe(false)
  vi.stubEnv('REPORT_SHARE_SECRET','short')
  expect(()=>signPortalLink(input)).toThrow()
 })
})
