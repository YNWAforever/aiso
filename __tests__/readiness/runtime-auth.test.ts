import { describe, expect, it, vi } from 'vitest'
import { authorizeProbe, readBoundedJson } from '@/lib/readiness/runtime-auth'

const secret = 'a'.repeat(32)
describe('readiness authorization', () => {
  it.each([undefined, 'short', 'a'.repeat(1025)])('rejects invalid server configuration', value => {
    expect(authorizeProbe(new Request('https://fixture.invalid', { headers: { authorization: 'Bearer ' + secret } }), value)).toBe(false)
  })
  it.each(['', 'bearer ' + secret, 'Bearer  ' + secret, 'Bearer ' + secret + ',other', 'Bearer ' + 'b'.repeat(32), 'Bearer ' + 'a'.repeat(1025)])('rejects malformed or mismatched authorization', authorization => {
    expect(authorizeProbe(new Request('https://fixture.invalid', { headers: { authorization, cookie: secret, 'x-forwarded-authorization': 'Bearer ' + secret } }), secret)).toBe(false)
  })
  it('accepts exact bearer', () => expect(authorizeProbe(new Request('https://fixture.invalid', { headers: { authorization: 'Bearer ' + secret } }), secret)).toBe(true))
})
describe('bounded request body', () => {
  function request(body: ReadableStream<Uint8Array>) { return new Request('https://fixture.invalid', { method: 'POST', body, duplex: 'half' } as RequestInit) }
  it('counts bytes rather than characters and cancels excess chunks', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(16384)); c.enqueue(new Uint8Array(1)) }, cancel })
    await expect(readBoundedJson(request(body))).rejects.toMatchObject({ status: 413 })
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false)
  })
  it('accepts exactly 16384 bytes', async () => {
    expect(await readBoundedJson(new Request('https://fixture.invalid', { method: 'POST', body: '"' + 'a'.repeat(16382) + '"' }))).toHaveLength(16382)
  })
  it('cancels pending read and releases lock on abort', async () => {
    const cancel = vi.fn(); const controller = new AbortController()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const result = readBoundedJson(request(body), 16384, controller.signal)
    controller.abort()
    await expect(result).rejects.toMatchObject({ status: 503 })
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false)
  })
})
