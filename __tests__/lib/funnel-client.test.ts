import { describe, expect, it, vi } from 'vitest'
import { consumeOneTimeFunnelEvent, trackFunnelEvent } from '@/lib/funnel-client'

describe('trackFunnelEvent', () => {
  it('consumes a mount-scoped event guard only once', () => {
    const guard = { current: false }

    expect(consumeOneTimeFunnelEvent(guard)).toBe(true)
    expect(consumeOneTimeFunnelEvent(guard)).toBe(false)
  })

  it('sends an allowlisted event with a reusable session attempt id', () => {
    const storage = new Map<string, string>()
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      () => Promise.resolve(new Response()),
    )
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    vi.stubGlobal('window', { sessionStorage: globalThis.sessionStorage })
    vi.stubGlobal('fetch', fetchMock)

    trackFunnelEvent({ name: 'signup_started', locale: 'en', provider: 'google' })
    trackFunnelEvent({ name: 'scan_claim_failed', locale: 'en', scanId: 'scan-1', errorCode: 'conflict' })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(storage.get('fimmick_funnel_attempt_id')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).toMatchObject({
      name: 'scan_claim_failed', scanId: 'scan-1', errorCode: 'conflict',
    })
  })

  it('uses a UUID-compatible fallback when randomUUID is unavailable', () => {
    const storage = new Map<string, string>()
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      () => Promise.resolve(new Response()),
    )
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    })
    vi.stubGlobal('window', { sessionStorage: globalThis.sessionStorage })
    vi.stubGlobal('crypto', { getRandomValues: (values: Uint8Array) => values.fill(7) })
    vi.stubGlobal('fetch', fetchMock)

    trackFunnelEvent({ name: 'scan_result_viewed', locale: 'en' })

    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).attemptId)
      .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })
})

it('T35 client sends only attempt and locale for onboarding, strips runtime extras',()=>{
 const storage=new Map<string,string>(),send=vi.fn<(input: RequestInfo | URL, init?: RequestInit)=>Promise<Response>>(async()=>new Response())
 vi.stubGlobal('window',{sessionStorage:{getItem:(k:string)=>storage.get(k)??null,setItem:(k:string,v:string)=>storage.set(k,v)}})
 vi.stubGlobal('fetch',send)
 trackFunnelEvent({name:'onboarding_started',locale:'zh-HK',email:'synthetic-private',url:'https://private.fixture',draft:'secret',scanId:'private-id',provider:'google'} as never)
 expect(send).toHaveBeenCalledOnce();expect(Object.keys(JSON.parse(send.mock.calls[0][1]!.body as string)).sort()).toEqual(['attemptId','locale','name'])
})
it('T35 rejected telemetry never throws or retries',async()=>{
 vi.stubGlobal('window',{sessionStorage:{getItem:()=>null,setItem:()=>{}}})
 const send=vi.fn(async()=>{throw Error('Synthetic diagnostics outage')});vi.stubGlobal('fetch',send)
 expect(()=>trackFunnelEvent({name:'onboarding_manual_selected',locale:'en'} as never)).not.toThrow();await Promise.resolve();expect(send).toHaveBeenCalledOnce()
})
