import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callMultiPlatform, callOpenRouter, callOpenRouterWithEvidence } from '@/lib/openrouter'

// Distinctive so a leak into the log line cannot be missed.
const PROMPT = 'PROMPT-TEXT-customer-page-content'
const REPLY = 'REPLY-TEXT-model-answer'

function completion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gen-123',
    model: 'anthropic/claude-4.5-haiku-20251001',
    choices: [{ finish_reason: 'stop', message: { content: REPLY } }],
    usage: { prompt_tokens: 120, completion_tokens: 45, total_tokens: 165, cost: 0.00042 },
    ...overrides,
  }
}

// A fresh Response per call: a body can be read only once, so sharing one
// would fail every call after the first in a fan-out.
function respondWith(body: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 })))
}

function call() {
  return callOpenRouter({
    label: 'fix.rewrite_chunks',
    model: 'anthropic/claude-haiku-4-5',
    messages: [{ role: 'user', content: PROMPT }],
  })
}

let info: ReturnType<typeof vi.spyOn>
let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-key')
  info = vi.spyOn(console, 'info').mockImplementation(() => {})
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('callOpenRouter usage logging', () => {

  it('returns served model, request and usage evidence for durable attempts',async()=>{
    respondWith(completion())
    expect(await callOpenRouterWithEvidence({label:'pulse.platform',model:'requested/model',messages:[{role:'user',content:PROMPT}]}))
      .toEqual({answer:REPLY,actualModel:'anthropic/claude-4.5-haiku-20251001',requestId:'gen-123',promptTokens:120,completionTokens:45,costUsd:0.00042,httpStatus:200})
    respondWith({choices:[{message:{content:REPLY}}]})
    expect(await callOpenRouterWithEvidence({label:'pulse.platform',model:'requested/model',messages:[{role:'user',content:PROMPT}]}))
      .toMatchObject({actualModel:null,requestId:null,costUsd:null})
  })

  it('logs one metadata line per completion and still returns the reply', async () => {
    respondWith(completion())

    await expect(call()).resolves.toBe(REPLY)

    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith({
      event: 'openrouter_usage',
      label: 'fix.rewrite_chunks',
      model: 'anthropic/claude-haiku-4-5',
      servedBy: 'anthropic/claude-4.5-haiku-20251001',
      generationId: 'gen-123',
      promptTokens: 120,
      completionTokens: 45,
      costUsd: 0.00042,
      finishReason: 'stop',
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('never logs the prompt or the reply', async () => {
    respondWith(completion())

    await call()

    const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls])
    expect(logged).not.toContain(PROMPT)
    expect(logged).not.toContain(REPLY)
  })

  it('warns when the reply was cut off at max_tokens', async () => {
    // The failure this exists for: callers parse the reply and fall back on a
    // parse error, so a truncated reply otherwise looks like a bad answer.
    respondWith(completion({ choices: [{ finish_reason: 'length', message: { content: '{"rewritten":"half' } }] }))

    await call()

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'openrouter_truncated', label: 'fix.rewrite_chunks', finishReason: 'length' }),
    )
    expect(info).not.toHaveBeenCalled()
  })

  it('logs nulls rather than failing the call when metadata is missing', async () => {
    respondWith({ choices: [{ message: { content: REPLY } }] })

    await expect(call()).resolves.toBe(REPLY)

    expect(info).toHaveBeenCalledWith({
      event: 'openrouter_usage',
      label: 'fix.rewrite_chunks',
      model: 'anthropic/claude-haiku-4-5',
      servedBy: null,
      generationId: null,
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
      finishReason: null,
    })
  })

  it('labels every call of a platform fan-out, distinguished by model', async () => {
    respondWith(completion())

    await callMultiPlatform([{ role: 'user', content: PROMPT }], 500, ['gpt-4o', 'claude-haiku'])

    const lines = info.mock.calls.map((args: unknown[]) => args[0] as { label: string; model: string })
    expect(lines.map((line: { label: string }) => line.label)).toEqual(['pulse.platform', 'pulse.platform'])
    expect(lines.map((line: { model: string }) => line.model).sort()).toEqual(['anthropic/claude-haiku-4-5', 'openai/gpt-4o'])
  })

})

describe('callOpenRouter failure logging', () => {
  // Every caller catches a failed call and substitutes a default, so without a
  // line here a missing or revoked key is silent. It was: production ran three
  // weeks with every scan's c18/c19 on fallback values and nothing in the logs.
  const failure = (fields: Record<string, unknown>) => ({
    event: 'openrouter_failed',
    label: 'fix.rewrite_chunks',
    model: 'anthropic/claude-haiku-4-5',
    ...fields,
  })

  it('logs missing_api_key and never sends the request when the key is unset', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', '')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(call()).rejects.toThrow('OPENROUTER_API_KEY is not set')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith(failure({ reason: 'missing_api_key' }))
  })

  it('logs the status and OpenRouter\'s own message for an HTTP error, and throws as before', async () => {
    const body = JSON.stringify({ error: { message: 'No auth credentials found', code: 401 } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 401 })))

    await expect(call()).rejects.toThrow(`OpenRouter 401: ${body}`)

    expect(error).toHaveBeenCalledWith(failure({ reason: 'http_error', status: 401, providerMessage: 'No auth credentials found' }))
    expect(info).not.toHaveBeenCalled()
  })

  it('logs a null providerMessage when the error body is not OpenRouter JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream down', { status: 502 })))

    await expect(call()).rejects.toThrow('OpenRouter 502: upstream down')

    expect(error).toHaveBeenCalledWith(failure({ reason: 'http_error', status: 502, providerMessage: null }))
  })

  it('logs timeout and network failures apart', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('signal timed out', 'TimeoutError')))
    await expect(call()).rejects.toThrow('signal timed out')
    expect(error).toHaveBeenLastCalledWith(failure({ reason: 'timeout' }))

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))
    await expect(call()).rejects.toThrow('fetch failed')
    expect(error).toHaveBeenLastCalledWith(failure({ reason: 'network' }))
  })

  it('logs invalid_json when a 200 body does not parse', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>gateway</html>', { status: 200 })))

    await expect(call()).rejects.toThrow()

    expect(error).toHaveBeenCalledWith(failure({ reason: 'invalid_json' }))
  })

  it('logs usage and no_content when a completion carries no text', async () => {
    // Tokens were still spent, so the usage line is kept.
    respondWith(completion({ choices: [{ finish_reason: 'stop', message: { content: null } }] }))

    await expect(call()).rejects.toThrow('OpenRouter returned no content')

    expect(info).toHaveBeenCalledWith(expect.objectContaining({ event: 'openrouter_usage', completionTokens: 45 }))
    expect(error).toHaveBeenCalledWith(failure({ reason: 'no_content', finishReason: 'stop' }))
  })

  it('never logs the prompt on a failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`echo: ${PROMPT}`, { status: 400 })))

    await expect(call()).rejects.toThrow()

    expect(JSON.stringify(error.mock.calls)).not.toContain(PROMPT)
  })
})
