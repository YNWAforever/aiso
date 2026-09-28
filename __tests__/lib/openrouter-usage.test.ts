import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callMultiPlatform, callOpenRouter } from '@/lib/openrouter'

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

describe('callOpenRouter usage logging', () => {
  let info: ReturnType<typeof vi.spyOn>
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
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

  it('logs nothing for a failed request, which throws as before', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('upstream down', { status: 502 })))

    await expect(call()).rejects.toThrow('OpenRouter 502: upstream down')

    expect(info).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })
})
