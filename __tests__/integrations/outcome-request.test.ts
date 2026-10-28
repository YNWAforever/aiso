import { describe, expect, it } from 'vitest'
import { readOutcomeBody } from '@/lib/outcome-integrations/request'
describe('bounded signed request body', () => {
  it('preserves exact whitespace and Unicode for signature verification', async () => {
    const body = ' {"name":"香港"} \n'
    expect(await readOutcomeBody(new Request('https://example.com', { method: 'POST', body }), 100)).toBe(body)
  })
  it('bounds actual streamed bytes even with a false content length', async () => {
    let cancelled = false
    const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(50)) }, cancel() { cancelled = true } })
    const request = new Request('https://example.com', { method: 'POST', body: stream, duplex: 'half', headers: { 'content-length': '1' } } as RequestInit)
    await expect(readOutcomeBody(request, 60)).rejects.toMatchObject({ status: 413 })
    expect(cancelled).toBe(true)
  })
  it('rejects invalid UTF-8 rather than signing a replacement character', async () => {
    await expect(readOutcomeBody(new Request('https://example.com', { method: 'POST', body: new Uint8Array([255]) }), 10)).rejects.toMatchObject({ status: 400 })
  })
})
