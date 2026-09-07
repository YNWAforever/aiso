import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { approvedVersion, attestInput, eventRow, ID, ACTOR_ID, VERSION_ID, REQUEST_ID } from '../delivery/fixtures'
import { deliveryEventDTO } from '@/lib/delivery/dto'
vi.mock('server-only', () => ({}))
const mocks=vi.hoisted(()=>({profile:vi.fn(),version:vi.fn(),read:vi.fn(),attest:vi.fn(),withdraw:vi.fn()}))
vi.mock('@/lib/auth',()=>({getProfile:mocks.profile}))
vi.mock('@/lib/delivery/store',()=>({readDeliveryVersion:mocks.version,readDelivery:mocks.read,attestDelivery:mocks.attest,withdrawDelivery:mocks.withdraw}))
import { GET as exportGET } from '@/app/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/export/route'
import { GET as deliveryGET, POST as deliveryPOST } from '@/app/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/delivery/route'
import { POST as withdrawPOST } from '@/app/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/delivery/[attestationId]/withdraw/route'
const accountId='123e4567-e89b-42d3-a456-426614174004'
const scope={accountId,clientId:REQUEST_ID,itemId:ID,versionId:VERSION_ID,actorId:ACTOR_ID}
const params={clientId:REQUEST_ID,workItemId:ID,versionId:VERSION_ID}
const context=()=>({params:Promise.resolve(params)})
const withdrawnContext=()=>({params:Promise.resolve({...params,attestationId:ACTOR_ID})})
const event=deliveryEventDTO(eventRow())
const page={events:[event],activeAttestationId:ID,capabilities:{canExport:true,canAttest:false,canWithdraw:true,attestReason:'active_attestation',withdrawReason:null},nextCursor:null}
const req=(query='',body?:unknown)=>new Request(`https://example.test/api/delivery${query}`,body===undefined?{}:{method:'POST',body:JSON.stringify(body)})
const routes=[
  {name:'export GET',store:mocks.version,call:()=>exportGET(req(),context())},
  {name:'delivery GET',store:mocks.read,call:()=>deliveryGET(req(),context())},
  {name:'delivery POST',store:mocks.attest,call:()=>deliveryPOST(req('',attestInput()),context())},
  {name:'withdraw POST',store:mocks.withdraw,call:()=>withdrawPOST(req('',{reason:'Corrected',requestId:REQUEST_ID}),withdrawnContext())},
]
beforeEach(()=>{
  vi.clearAllMocks()
  mocks.profile.mockResolvedValue({id:ACTOR_ID,account_id:accountId,is_admin:true})
  mocks.version.mockResolvedValue({kind:'replayed',value:approvedVersion()})
  mocks.read.mockResolvedValue({kind:'replayed',value:page})
  mocks.attest.mockResolvedValue({kind:'created',value:event})
  mocks.withdraw.mockResolvedValue({kind:'created',value:event})
})
describe.each(routes)('$name actual route and service',route=>{
  it('awaits promised params and derives owned actor scope through authentication',async()=>{
    await route.call()
    expect(route.store.mock.calls[0][0]).toEqual(scope)
    expect(mocks.profile).toHaveBeenCalledOnce()
  })
  it('cannot bypass independent authentication',async()=>{
    mocks.profile.mockResolvedValue(null)
    const response=await route.call()
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({error:'DELIVERY_UNAUTHENTICATED'})
    expect(route.store).not.toHaveBeenCalled()
  })
  it.each([['not_found',404],['denied',403],['conflict',409],['validation_failed',422]] as const)('retains service %s response',async(kind,status)=>{
    route.store.mockResolvedValue({kind})
    const response=await route.call()
    expect(response.status).toBe(status)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({error:`DELIVERY_${kind.toUpperCase()}`})
  })
  it('retains safe service dependency errors',async()=>{
    route.store.mockRejectedValue(new Error('SQL SECRET'))
    const response=await route.call()
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({error:'DELIVERY_UNAVAILABLE'})
  })
})
it.each(['json','text'])('returns deterministic %s attachment and never writes delivery history',async format=>{
  const response=await exportGET(req(`?format=${format}`),context())
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('content-disposition')).toBe(`attachment; filename="delivery-${VERSION_ID}.${format==='json'?'json':'txt'}"`)
  expect(response.headers.get('content-type')).toBe(format==='json'?'application/json; charset=utf-8':'text/plain; charset=utf-8')
  const body=await response.text()
  if(format==='json') expect(response.headers.get('x-aiso-export-sha256')).toBe(createHash('sha256').update(body).digest('hex'))
  else expect(body).toContain(`Export hash: ${response.headers.get('x-aiso-export-sha256')}`)
  expect(mocks.attest).not.toHaveBeenCalled(); expect(mocks.withdraw).not.toHaveBeenCalled()
})
it('forwards list search params and returns the unwrapped page',async()=>{
  const response=await deliveryGET(req('?limit=7'),context())
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual(page)
  expect(mocks.read).toHaveBeenCalledWith(scope,{limit:7,cursor:null})
  expect(mocks.attest).not.toHaveBeenCalled(); expect(mocks.withdraw).not.toHaveBeenCalled()
})
it.each(['created','replayed'])('preserves %s mutation status and body for both POST routes',async kind=>{
  mocks.attest.mockResolvedValue({kind,value:event}); mocks.withdraw.mockResolvedValue({kind,value:event})
  for(const response of [await deliveryPOST(req('',attestInput()),context()),await withdrawPOST(req('',{reason:' Corrected ',requestId:REQUEST_ID}),withdrawnContext())]) {
    expect(response.status).toBe(kind==='created'?201:200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({event})
  }
  expect(mocks.attest).toHaveBeenCalledWith(scope,attestInput())
  expect(mocks.withdraw).toHaveBeenCalledWith(scope,ACTOR_ID,{reason:'Corrected',requestId:REQUEST_ID})
})
it('rejects forged identity, invalid query and path through real services',async()=>{
  const responses=[await exportGET(req('?format=json&format=text'),context()),await deliveryGET(req('?accountId=forged'),context()),await deliveryPOST(req('',{...attestInput(),accountId}),context()),await withdrawPOST(req('',{reason:'Corrected',requestId:REQUEST_ID}),{params:Promise.resolve({...params,attestationId:'bad'})})]
  for(const response of responses) {
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({error:'DELIVERY_INVALID_INPUT'})
  }
  for(const route of routes) expect(route.store).not.toHaveBeenCalled()
})
it('retains actual streamed-body size rejection',async()=>{
  const response=await deliveryPOST(new Request('https://example.test',{method:'POST',body:' '.repeat(16385),headers:{'Content-Length':'1'}}),context())
  expect(response.status).toBe(413)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({error:'DELIVERY_BODY_TOO_LARGE'})
  expect(mocks.attest).not.toHaveBeenCalled()
})
