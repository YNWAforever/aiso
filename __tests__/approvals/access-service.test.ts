import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readLimitedJson, approvalErrorResponse } from '@/lib/approvals/request'
import { changeApproverAccess, getApproverAccess } from '@/lib/approvals/access-service'
const mocks = vi.hoisted(() => ({ guard: vi.fn(), mutate: vi.fn(), list: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ requireApiAdmin: mocks.guard }))
vi.mock('@/lib/approvals/access-store', () => ({ mutateApproverAccess: mocks.mutate, listApproverAccess: mocks.list }))
beforeEach(() => vi.resetAllMocks())
describe('bounded approval requests', () => {
  it('counts whitespace bytes and cancels overflow', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(' '.repeat(4097))) }, cancel })
    const request = new Request('http://local', { method: 'POST', body, duplex: 'half' } as RequestInit)
    await expect(readLimitedJson(request, 4096)).rejects.toThrow('APPROVAL_BODY_TOO_LARGE')
    expect(cancel).toHaveBeenCalled(); expect(body.locked).toBe(false)
  })
  it('accepts JSON and rejects malformed UTF8', async () => {
    expect(await readLimitedJson(new Request('http://local', {method:'POST',body:' {} '}),4096)).toEqual({})
    await expect(readLimitedJson(new Request('http://local',{method:'POST',body:new Uint8Array([0xff])}),4096)).rejects.toThrow('INVALID_APPROVAL_INPUT')
  })
  it('maps read errors and abort safely and releases locks', async () => {
    const body = new ReadableStream({ pull(c) { c.error(new Error('secret')) } })
    await expect(readLimitedJson(new Request('http://local',{method:'POST',body,duplex:'half'} as RequestInit),16384)).rejects.toThrow('INVALID_APPROVAL_INPUT')
    expect(body.locked).toBe(false)
    const controller = new AbortController(); controller.abort()
    await expect(readLimitedJson(new Request('http://local',{method:'POST',body:'{}',signal:controller.signal}),4096)).rejects.toThrow('INVALID_APPROVAL_INPUT')
  })
  it('uses stable safe errors', async () => {
    expect(approvalErrorResponse(new Error('secret')).status).toBe(503)
    expect(await approvalErrorResponse(new Error('secret')).json()).toEqual({error:'APPROVAL_UNAVAILABLE'})
  })
})
describe('admin service boundary', () => {
  it('denies before reading body or target data', async () => {
    mocks.guard.mockResolvedValue({ok:false,response:Response.json({error:'Forbidden'},{status:403})})
    const request = new Request('http://local',{method:'POST',body:'invalid'})
    expect((await changeApproverAccess('bad',request)).status).toBe(403)
    expect(request.bodyUsed).toBe(false); expect(mocks.mutate).not.toHaveBeenCalled()
    expect((await getApproverAccess('bad',new URLSearchParams())).status).toBe(403)
    expect(mocks.list).not.toHaveBeenCalled()
  })
  it('maps session outages to unavailable', async () => {
    mocks.guard.mockRejectedValue(new Error('secret'))
    expect((await getApproverAccess('bad',new URLSearchParams())).status).toBe(503)
  })
})

it('rejects whitespace-inflated access body at 16 KiB and ignores understated headers',async()=>{
 const request=new Request('http://local',{method:'POST',headers:{'Content-Length':'2'},body:' '.repeat(16384)+'{}'})
 await expect(readLimitedJson(request,16384)).rejects.toThrow('APPROVAL_BODY_TOO_LARGE')
})
it('aborts an in-flight read and releases the reader',async()=>{
 const controller=new AbortController(),cancel=vi.fn()
 const body=new ReadableStream({cancel})
 const request=new Request('http://local',{method:'POST',body,signal:controller.signal,duplex:'half'} as RequestInit)
 const reading=readLimitedJson(request,4096)
 controller.abort()
 await expect(reading).rejects.toThrow('INVALID_APPROVAL_INPUT')
 expect(cancel).toHaveBeenCalled();expect(body.locked).toBe(false)
})
it('maps store outcomes with safe codes and parses normalized input',async()=>{
 const account='22222222-2222-4222-8222-222222222222'
 mocks.guard.mockResolvedValue({ok:true,profile:{id:'11111111-1111-4111-8111-111111111111'}})
 const input={profileId:'33333333-3333-4333-8333-333333333333',action:'grant',reason:'  Re\u0301ason ',expectedRevision:0,requestId:'44444444-4444-4444-8444-444444444444'}
 for(const [kind,status] of [['denied',403],['not_found',404],['conflict',409],['validation_failed',400]] as const){
  mocks.mutate.mockResolvedValue({kind})
  const result=await changeApproverAccess(account,new Request('http://local',{method:'POST',body:JSON.stringify(input)}))
  expect(result.status).toBe(status);expect(await result.json()).toEqual({error:'APPROVAL_'+kind.toUpperCase()})
 }
 expect(mocks.mutate.mock.calls[0][2].reason).toBe('Réason')
 mocks.mutate.mockRejectedValue(new Error('database secret'))
 expect((await changeApproverAccess(account,new Request('http://local',{method:'POST',body:JSON.stringify(input)}))).status).toBe(503)
})
