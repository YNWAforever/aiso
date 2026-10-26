import { beforeEach,describe,expect,it,vi } from 'vitest'
const h=vi.hoisted(()=>({profile:vi.fn(),flag:vi.fn(),client:vi.fn()}))
vi.mock('@/lib/auth',()=>({getProfile:h.profile}))
vi.mock('@/lib/flags',()=>({isFeatureEnabled:h.flag}))
vi.mock('@/lib/localTrust/store',()=>({verifyClientOwnership:h.client}))
import { authorizeVisibilityClient } from '@/lib/visibility/guard'
const id='22000000-0000-4000-8000-000000000001'
beforeEach(()=>{vi.clearAllMocks();h.flag.mockReturnValue(true);h.profile.mockResolvedValue({id:'member',account_id:'account',accounts:{plan:'pro',status:'active',stripe_subscription_id:'sub_fixture'}});h.client.mockResolvedValue({id,domain:'example.com'})})
describe('visibility workspace gate',()=>{
 it('returns scope only after flag/session/runtime entitlement and ownership',async()=>{
  expect(await authorizeVisibilityClient(id)).toMatchObject({scope:{accountId:'account',clientId:id}})
  expect(h.client).toHaveBeenCalledWith(id,'account')
 })
 it.each(['flag','session','plan','foreign'])('refuses %s',async reason=>{
  if(reason==='flag')h.flag.mockReturnValue(false)
  if(reason==='session')h.profile.mockResolvedValue(null)
  if(reason==='plan')h.profile.mockResolvedValue({account_id:'account',accounts:{plan:'free'}})
  if(reason==='foreign')h.client.mockResolvedValue(null)
  await expect(authorizeVisibilityClient(id)).rejects.toMatchObject({status:reason==='session'?401:reason==='plan'?403:404})
  if(reason!=='foreign')expect(h.client).not.toHaveBeenCalled()
 })
 it('propagates a read outage rather than inventing an unauthenticated or empty state',async()=>{
  h.profile.mockRejectedValue(new Error('synthetic unavailable'))
  await expect(authorizeVisibilityClient(id)).rejects.toThrow('synthetic unavailable')
 })
})
