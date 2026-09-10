import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { approvedVersion, attestInput, eventRow, ID, ACTOR_ID, VERSION_ID, REQUEST_ID } from './fixtures'
import { deliveryEventDTO } from '@/lib/delivery/dto'
vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({profile:vi.fn(),readVersion:vi.fn(),read:vi.fn(),attest:vi.fn(),withdraw:vi.fn(),recordExport:vi.fn()}))
vi.mock('@/lib/auth', () => ({getProfile:mocks.profile}))
vi.mock('@/lib/delivery/store', () => ({readDeliveryVersion:mocks.readVersion,readDelivery:mocks.read,attestDelivery:mocks.attest,withdrawDelivery:mocks.withdraw,recordExportEvent:mocks.recordExport}))
import { exportAuthenticatedDelivery, listAuthenticatedDelivery, attestAuthenticatedDelivery, withdrawAuthenticatedDelivery } from '@/lib/delivery/service'
const accountId='123e4567-e89b-42d3-a456-426614174004'
const clientId=REQUEST_ID, itemId=ID, versionId=VERSION_ID
const scope={accountId,clientId,itemId,versionId,actorId:ACTOR_ID}
const event=deliveryEventDTO(eventRow())
const page={events:[event],activeAttestationId:ID,capabilities:{canExport:true,canAttest:false,canWithdraw:true,attestReason:'active_attestation',withdrawReason:null},nextCursor:null}
const request=(body: unknown) => new Request('https://example.test/delivery',{method:'POST',body:JSON.stringify(body)})
const operations = [
  {name:'export',store:mocks.readVersion,call:(client=clientId,item=itemId,version=versionId) => exportAuthenticatedDelivery(client,item,version,new URLSearchParams())},
  {name:'list',store:mocks.read,call:(client=clientId,item=itemId,version=versionId) => listAuthenticatedDelivery(client,item,version,new URLSearchParams())},
  {name:'attest',store:mocks.attest,call:(client=clientId,item=itemId,version=versionId) => attestAuthenticatedDelivery(client,item,version,request(attestInput()))},
  {name:'withdraw',store:mocks.withdraw,call:(client=clientId,item=itemId,version=versionId) => withdrawAuthenticatedDelivery(client,item,version,ID,request({reason:'Correcting',requestId:REQUEST_ID}))},
]
async function error(response: Response, status: number, code: string) {
  expect(response.status).toBe(status)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({error:code})
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.profile.mockResolvedValue({id:ACTOR_ID,account_id:accountId,is_admin:true})
  mocks.readVersion.mockResolvedValue({kind:'replayed',value:approvedVersion()})
  mocks.recordExport.mockResolvedValue(true)
  mocks.read.mockResolvedValue({kind:'replayed',value:page})
  mocks.attest.mockResolvedValue({kind:'created',value:event})
  mocks.withdraw.mockResolvedValue({kind:'created',value:event})
})
describe.each(operations)('$name authenticated boundary', operation => {
  it('authenticates before malformed paths, body or store access', async () => {
    mocks.profile.mockResolvedValue(null)
    await error(await operation.call('bad','bad','bad'),401,'DELIVERY_UNAUTHENTICATED')
    expect(operation.store).not.toHaveBeenCalled()
  })
  it('distinguishes auth dependency outage from absent authentication', async () => {
    mocks.profile.mockRejectedValue(new Error('password SECRET'))
    await error(await operation.call(),503,'DELIVERY_UNAVAILABLE')
    expect(operation.store).not.toHaveBeenCalled()
  })
  it.each([0,1,2])('rejects invalid path segment %i before store access', async position => {
    const ids=[clientId,itemId,versionId]; ids[position]='bad'
    await error(await operation.call(...ids as [string,string,string]),400,'DELIVERY_INVALID_INPUT')
    expect(operation.store).not.toHaveBeenCalled()
  })
  it('normalizes paths and derives account and actor only from the session', async () => {
    await operation.call(clientId.toUpperCase(),itemId.toUpperCase(),versionId.toUpperCase())
    expect(operation.store.mock.calls[0][0]).toEqual(scope)
  })
  it.each([['not_found',404],['denied',403],['conflict',409],['validation_failed',422]] as const)('maps %s to %i without response wrappers', async (kind,status) => {
    operation.store.mockResolvedValue({kind})
    await error(await operation.call(),status,`DELIVERY_${kind.toUpperCase()}`)
  })
  it('redacts store outages', async () => {
    operation.store.mockRejectedValue(new Error('SQL password SECRET'))
    await error(await operation.call(),503,'DELIVERY_UNAVAILABLE')
  })
})
it.each(['format=pdf','format=json&format=text','accountId=forged'])('rejects invalid export query %s', async query => {
  await error(await exportAuthenticatedDelivery(clientId,itemId,versionId,new URLSearchParams(query)),400,'DELIVERY_INVALID_INPUT')
  expect(mocks.readVersion).not.toHaveBeenCalled()
})
it.each(['limit=51','limit=2&limit=3','cursor=invalid','accountId=forged'])('rejects invalid list query %s', async query => {
  await error(await listAuthenticatedDelivery(clientId,itemId,versionId,new URLSearchParams(query)),400,'DELIVERY_INVALID_INPUT')
  expect(mocks.read).not.toHaveBeenCalled()
})
it('unwraps list history and preserves precision without invoking mutations', async () => {
  const response=await listAuthenticatedDelivery(clientId,itemId,versionId,new URLSearchParams('limit=10'))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual(page)
  expect(mocks.read).toHaveBeenCalledWith(scope,{limit:10,cursor:null})
  expect(mocks.attest).not.toHaveBeenCalled(); expect(mocks.withdraw).not.toHaveBeenCalled()
})
it('records an export receipt carrying both hashes before releasing the bytes', async () => {
  const response = await exportAuthenticatedDelivery(clientId, itemId, versionId, new URLSearchParams())

  expect(response.status).toBe(200)
  expect(mocks.recordExport).toHaveBeenCalledOnce()
  const [scopeArg, input] = mocks.recordExport.mock.calls[0]!
  expect(scopeArg).toMatchObject({accountId, clientId, itemId, versionId, actorId: ACTOR_ID})
  // The approved payload hash and the rendered artifact hash are different facts
  // and are recorded separately; requiring them to be equal would be wrong.
  expect(input.contentHash).toBe(approvedVersion().contentHash)
  expect(input.artifactHash).toBe(response.headers.get('x-aiso-export-sha256'))
  expect(input.artifactHash).not.toBe(input.contentHash)
  expect(input.rendererVersion).toBe('delivery-export.v1')
  // The downloader, not the submitter. Migration 045 ties actor.profileId to
  // actor_id, so recording the submitter would misattribute the download and
  // break the constraint whenever the two people differ.
  expect(input.actor).toEqual({profileId: ACTOR_ID, displayName: null, role: 'account_member'})
})

it('fails the export rather than releasing approved content with no receipt', async () => {
  // A write that did not land must not be reported as success, and approved
  // content leaving unrecorded is the thing the receipt exists to prevent.
  mocks.recordExport.mockResolvedValueOnce(false)
  await error(await exportAuthenticatedDelivery(clientId, itemId, versionId, new URLSearchParams()), 409, 'DELIVERY_CONFLICT')

  mocks.recordExport.mockRejectedValueOnce(new Error('connection lost'))
  await error(await exportAuthenticatedDelivery(clientId, itemId, versionId, new URLSearchParams()), 503, 'DELIVERY_UNAVAILABLE')
})

it.each(['json','text'] as const)('returns immutable %s attachment without creating an event', async format => {
  const response=await exportAuthenticatedDelivery(clientId,itemId,versionId,new URLSearchParams({format}))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('content-disposition')).toBe(`attachment; filename="delivery-${versionId}.${format==='json'?'json':'txt'}"`)
  expect(response.headers.get('content-type')).toBe(format==='json'?'application/json; charset=utf-8':'text/plain; charset=utf-8')
  const body=await response.text()
  if(format==='json') expect(response.headers.get('x-aiso-export-sha256')).toBe(createHash('sha256').update(body,'utf8').digest('hex'))
  else expect(body).toContain(`Export hash: ${response.headers.get('x-aiso-export-sha256')}`)
  expect(mocks.attest).not.toHaveBeenCalled(); expect(mocks.withdraw).not.toHaveBeenCalled()
})
it.each([null,'changes_requested'] as const)('returns 409 for unapproved package %s', async decision => {
  const version=approvedVersion(); version.decision=decision===null?null:{...version.decision!,decision}
  mocks.readVersion.mockResolvedValue({kind:'replayed',value:version})
  await error(await exportAuthenticatedDelivery(clientId,itemId,versionId,new URLSearchParams()),409,'DELIVERY_NOT_APPROVED')
})
it('returns 422 for a malformed retained package', async () => {
  mocks.readVersion.mockResolvedValue({kind:'replayed',value:{...approvedVersion(),contentHash:'bad'}})
  await error(await exportAuthenticatedDelivery(clientId,itemId,versionId,new URLSearchParams()),422,'DELIVERY_VALIDATION_FAILED')
})
it.each(['created','replayed'])('unwraps normalized attest event as %s', async kind => {
  mocks.attest.mockResolvedValue({kind,value:event})
  const input={...attestInput(),destination:' e\u0301 ',note:'Delivered\r\nmanually'}
  const response=await attestAuthenticatedDelivery(clientId,itemId,versionId,request(input))
  expect(response.status).toBe(kind==='created'?201:200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({event})
  expect(mocks.attest).toHaveBeenCalledWith(scope,{...input,destination:'é',note:'Delivered\nmanually'})
})
it.each(['created','replayed'])('unwraps normalized withdrawal event as %s', async kind => {
  mocks.withdraw.mockResolvedValue({kind,value:event})
  const response=await withdrawAuthenticatedDelivery(clientId,itemId,versionId,ID.toUpperCase(),request({reason:' Corrected ',requestId:REQUEST_ID}))
  expect(response.status).toBe(kind==='created'?201:200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({event})
  expect(mocks.withdraw).toHaveBeenCalledWith(scope,ID,{reason:'Corrected',requestId:REQUEST_ID})
})
it('rejects invalid withdrawal path before body consumption or mutation', async () => {
  const req=request({reason:'Corrected',requestId:REQUEST_ID})
  await error(await withdrawAuthenticatedDelivery(clientId,itemId,versionId,'bad',req),400,'DELIVERY_INVALID_INPUT')
  expect(req.bodyUsed).toBe(false); expect(mocks.withdraw).not.toHaveBeenCalled()
})
it.each([{...attestInput(),accountId:'forged'},{...attestInput(),actorId:ID},{...attestInput(),deliveredAt:'2026-02-30T00:00:00Z'},{...attestInput(),note:''},null])('rejects invalid attest input', async input => {
  await error(await attestAuthenticatedDelivery(clientId,itemId,versionId,request(input)),400,'DELIVERY_INVALID_INPUT')
  expect(mocks.attest).not.toHaveBeenCalled()
})
it.each([{reason:'Corrected',requestId:REQUEST_ID,actorId:ID},{reason:'',requestId:REQUEST_ID},{}])('rejects invalid withdraw input', async input => {
  await error(await withdrawAuthenticatedDelivery(clientId,itemId,versionId,ID,request(input)),400,'DELIVERY_INVALID_INPUT')
  expect(mocks.withdraw).not.toHaveBeenCalled()
})
function streamRequest(chunks: Uint8Array[], cancel=vi.fn(), signal?: AbortSignal) {
  let index=0
  const body=new ReadableStream<Uint8Array>({pull(controller) { if(index<chunks.length) controller.enqueue(chunks[index++]); else controller.close() },cancel})
  return new Request('https://example.test/delivery',{method:'POST',body,headers:{'Content-Length':'1'},signal,duplex:'half'} as RequestInit)
}
it('counts streamed multibyte bytes despite a lying Content-Length and cancels oversize reads', async () => {
  const encoder=new TextEncoder(), cancel=vi.fn()
  const req=streamRequest([encoder.encode(' '.repeat(16000)),encoder.encode('界'.repeat(200)),encoder.encode('unread')],cancel)
  await error(await attestAuthenticatedDelivery(clientId,itemId,versionId,req),413,'DELIVERY_BODY_TOO_LARGE')
  expect(cancel).toHaveBeenCalled(); expect(mocks.attest).not.toHaveBeenCalled()
})
it('applies actual byte cap to withdrawal too', async () => {
  await error(await withdrawAuthenticatedDelivery(clientId,itemId,versionId,ID,new Request('https://example.test',{method:'POST',body:' '.repeat(16385)})),413,'DELIVERY_BODY_TOO_LARGE')
  expect(mocks.withdraw).not.toHaveBeenCalled()
})
it('accepts exactly 16384 actual bytes and split UTF8 characters', async () => {
  const input={...attestInput(),destination:'界'}
  const encoder=new TextEncoder(), bytes=encoder.encode(JSON.stringify(input)), text=encoder.encode('界')
  const split=bytes.findIndex((byte,index)=>byte===text[0]&&bytes[index+1]===text[1]) + 1
  const req=streamRequest([bytes.slice(0,split),bytes.slice(split),encoder.encode(' '.repeat(16384-bytes.byteLength))])
  expect((await attestAuthenticatedDelivery(clientId,itemId,versionId,req)).status).toBe(201)
})
it.each([new Uint8Array([0xff]),new Uint8Array([0xe2,0x82])])('rejects invalid or truncated UTF8', async bytes => {
  await error(await attestAuthenticatedDelivery(clientId,itemId,versionId,streamRequest([bytes])),400,'DELIVERY_INVALID_INPUT')
  expect(mocks.attest).not.toHaveBeenCalled()
})
it('rejects malformed JSON and missing bodies', async () => {
  for (const req of [new Request('https://example.test',{method:'POST',body:'{'}),new Request('https://example.test',{method:'POST'})]) {
    await error(await attestAuthenticatedDelivery(clientId,itemId,versionId,req),400,'DELIVERY_INVALID_INPUT')
  }
})
it('cancels a pending read on abort and never mutates', async () => {
  const abort=new AbortController(), cancel=vi.fn()
  let entered!:()=>void
  const reading=new Promise<void>(resolve=>{entered=resolve})
  const body=new ReadableStream<Uint8Array>({pull(){entered()},cancel},{highWaterMark:0})
  const req=new Request('https://example.test',{method:'POST',body,signal:abort.signal,duplex:'half'} as RequestInit)
  const response=attestAuthenticatedDelivery(clientId,itemId,versionId,req)
  await reading; abort.abort()
  await error(await response,400,'DELIVERY_INVALID_INPUT')
  expect(cancel).toHaveBeenCalled(); expect(mocks.attest).not.toHaveBeenCalled()
})
it('rejects already aborted requests', async () => {
  const abort=new AbortController(); abort.abort()
  await error(await attestAuthenticatedDelivery(clientId,itemId,versionId,streamRequest([],vi.fn(),abort.signal)),400,'DELIVERY_INVALID_INPUT')
  expect(mocks.attest).not.toHaveBeenCalled()
})
