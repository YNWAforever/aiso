import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callOpenRouterWithEvidenceStream } from '@/lib/openrouter'

/** A text/event-stream body that can be split at arbitrary byte boundaries. */
function streamResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}

const frame = (content: string, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ model: 'openai/gpt-4o-2024-08-06', choices: [{ index: 0, delta: { content }, finish_reason: null }], ...extra })}\n\n`

const USAGE_FRAME = `data: ${JSON.stringify({ model: 'openai/gpt-4o-2024-08-06', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.0004 } })}\n\n`

let fetchMock: ReturnType<typeof vi.fn>
const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals() })

const ask = () => callOpenRouterWithEvidenceStream(
  { label: 'studio.answer', model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'Q' }], maxTokens: 500 },
  () => {},
)

describe('streaming completion assembly', () => {
  it('assembles deltas split across read boundaries and keeps usage metadata', async () => {
    // Split inside an SSE line and inside a multi-byte-free string chunk: the
    // parser must join reads before treating a line as complete.
    const full = frame('Hello') + frame(' world', { id: 'gen-1' }) + USAGE_FRAME + 'data: [DONE]\n\n'
    const parts = [full.slice(0, 9), full.slice(9, 61), full.slice(61, 63), full.slice(63)]
    fetchMock.mockResolvedValue(streamResponse(parts))
    const deltas: string[] = []
    const evidence = await callOpenRouterWithEvidenceStream(
      { label: 'studio.answer', model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'Q' }], maxTokens: 500 },
      delta => deltas.push(delta),
    )
    expect(deltas).toEqual(['Hello', ' world'])
    expect(evidence.answer).toBe('Hello world')
    expect(evidence.promptTokens).toBe(12)
    expect(evidence.completionTokens).toBe(3)
    expect(evidence.costUsd).toBe(0.0004)
    expect(evidence.providerFinishReason).toBe('stop')
    expect(evidence.actualModel).toBe('openai/gpt-4o-2024-08-06')
    expect(evidence.requestId).toBe('gen-1')
  })

  it('asks for an actual stream and ignores non-data SSE comments and event lines', async () => {
    fetchMock.mockResolvedValue(streamResponse([
      ': OPENROUTER PROCESSING\n\n',
      'event: message\n',
      frame('ok') + USAGE_FRAME + 'data: [DONE]\n\n',
    ]))
    await ask()
    const [body] = bodies()
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
    expect(body.response_format).toBeUndefined()
  })

  it('collects provider citations streamed as annotations', async () => {
    fetchMock.mockResolvedValue(streamResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'cited', annotations: [{ type: 'url_citation', url_citation: { url: 'https://source.example/a', title: 'A' } }] }, finish_reason: null }] })}\n\n`,
      USAGE_FRAME,
      'data: [DONE]\n\n',
    ]))
    const evidence = await ask()
    expect(evidence.providerCitations).toEqual([{ url: 'https://source.example/a', title: 'A' }])
  })
})

describe('streaming failures stay explicit', () => {
  it('rejects a completed stream with no [DONE] and no finish reason', async () => {
    fetchMock.mockResolvedValue(streamResponse([frame('partial')]))
    await expect(ask()).rejects.toThrow(/incomplete stream/)
  })

  it('rejects an upstream error frame', async () => {
    fetchMock.mockResolvedValue(streamResponse([`data: ${JSON.stringify({ error: { message: 'upstream exploded' } })}\n\n`]))
    await expect(ask()).rejects.toThrow(/stream returned an error/)
  })

  it('rejects an empty completion', async () => {
    fetchMock.mockResolvedValue(streamResponse(['data: [DONE]\n\n']))
    await expect(ask()).rejects.toThrow(/no content/)
  })

  it('rejects a non-2xx response without reading its body', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 }))
    await expect(ask()).rejects.toThrow(/HTTP 400/)
  })

  it('does not retry a failed stream and does not fall back to a buffered call', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 503 }))
    await expect(ask()).rejects.toThrow(/HTTP 503/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodies().every(body => body.stream === true)).toBe(true)
  })
})
