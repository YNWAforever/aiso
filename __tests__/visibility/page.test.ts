import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only',()=>({}))
import { validateVisibilityPage } from '@/lib/visibility/page'
describe('bounded page identity prerequisite for revalidation',()=>{
  it('keeps canonical page identity and compact hashes without retaining HTML',async()=>{
    const fetcher=vi.fn(async()=>new Response('<html><head><title>Private customer text</title></head><body>Hello</body></html>',{headers:{'content-type':'text/html'}}))
    const result=await validateVisibilityPage('https://example.com/service','example.com',fetcher)
    expect(result).toMatchObject({url:'https://example.com/service',collection:'complete',canonicalState:'missing',titlePresent:true,method:'visibility-page.v1'})
    expect(JSON.stringify(result)).not.toContain('Private customer text')
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
  })
  it('does not treat blocked, failed or non-HTML fetches as proof of missing metadata',async()=>{
    const failed=await validateVisibilityPage('https://example.com/a','example.com',async()=>{throw Error('token=secret')})
    expect(failed).toMatchObject({collection:'failed',canonicalState:'unverifiable'})
    const json=await validateVisibilityPage('https://example.com/a','example.com',async()=>new Response('{}',{headers:{'content-type':'application/json'}}))
    expect(json).toMatchObject({collection:'unsupported',canonicalState:'unverifiable'})
  })
  it('rejects foreign targets before any fetch',async()=>{
    const fetcher=vi.fn()
    await expect(validateVisibilityPage('https://foreign.example/a','example.com',fetcher)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
