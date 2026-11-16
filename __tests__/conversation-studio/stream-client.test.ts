import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestStudioAnswer } from '@/lib/conversation-studio/stream-client'

const input = { prompt: 'Q', platforms: ['gemini-flash'], language: 'zh-HK' as const, threadId: '55555555-5555-4555-8555-555555555555', position: 2 }
const replyBody = { answers: [], quota: { cap: 10, remaining: 9, scope: 'brand' } }

function sseResponse(parts: string[], status = 200) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close() },
  }), { status, headers: { 'content-type': 'text/event-stream; charset=utf-8' } })
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const run = async (response: Response) => {
  fetchMock.mockResolvedValue(response)
  const deltas: Array<[string, string]> = []
  const outcome = await requestStudioAnswer({ clientId: 'brand-1', input, signal: new AbortController().signal, onDelta: (platform, text) => deltas.push([platform, text]) })
  return { outcome, deltas }
}
const request = () => (fetchMock.mock.calls[0] as [string, RequestInit])

describe('requestStudioAnswer streaming transport', () => {
  it('negotiates SSE and applies deltas split across chunk boundaries', async () => {
    const text = 'event: start\ndata: {"platforms":["gemini-flash"]}\n\n'
      + 'event: delta\ndata: {"platform":"gemini-flash","text":"Hello"}\n\n'
      + 'event: delta\ndata: {"platform":"gemini-flash","text":" world"}\n\n'
      + `event: done\ndata: ${JSON.stringify(replyBody)}\n\n`
    const { outcome, deltas } = await run(sseResponse([text.slice(0, 17), text.slice(17, 49), text.slice(49)]))
    expect(request()[1].headers).toMatchObject({ Accept: 'text/event-stream' })
    expect(deltas).toEqual([['gemini-flash', 'Hello'], ['gemini-flash', ' world']])
    expect(outcome).toEqual({ kind: 'reply', reply: replyBody })
  })

  it('returns a buffered JSON reply when the server did not stream', async () => {
    const { outcome, deltas } = await run(new Response(JSON.stringify(replyBody), { status: 200, headers: { 'content-type': 'application/json' } }))
    expect(deltas).toEqual([])
    expect(outcome).toEqual({ kind: 'reply', reply: replyBody })
  })

  it('maps a concurrent claim to pending, and a spent quota to an explicit error', async () => {
    const pending = await run(new Response(JSON.stringify({ error: 'STUDIO_ANSWER_PENDING' }), { status: 409 }))
    expect(pending.outcome).toEqual({ kind: 'pending' })
    const spent = await run(new Response(JSON.stringify({ error: 'STUDIO_QUOTA_EXCEEDED' }), { status: 429 }))
    expect(spent.outcome).toEqual({ kind: 'error', error: 'STUDIO_QUOTA_EXCEEDED' })
  })

  it('surfaces an SSE error frame instead of pretending completion', async () => {
    const { outcome } = await run(sseResponse(['event: error\ndata: {"error":"STUDIO_ANSWER_UNKNOWN"}\n\n']))
    expect(outcome).toEqual({ kind: 'error', error: 'STUDIO_ANSWER_UNKNOWN' })
  })

  it('treats a stream that ends without a terminal frame as unconfirmed', async () => {
    const { outcome } = await run(sseResponse(['event: delta\ndata: {"platform":"gemini-flash","text":"partial"}\n\n']))
    expect(outcome).toEqual({ kind: 'unconfirmed' })
  })

  it('treats a transport failure mid-stream as unconfirmed, never as an answer', async () => {
    fetchMock.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"platform":"gemini-flash","text":"par"}\n\n'))
        controller.error(new Error('network reset'))
      },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    const outcome = await requestStudioAnswer({ clientId: 'brand-1', input, signal: new AbortController().signal, onDelta: () => {} })
    expect(outcome).toEqual({ kind: 'unconfirmed' })
  })
})
