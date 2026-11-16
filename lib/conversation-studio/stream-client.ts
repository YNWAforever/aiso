import type { StudioLiveReply } from './live-types'

/**
 * Result of one Studio answer request, whichever transport the server chose.
 * `unconfirmed` means the stream ended (or broke) without the server's `done`:
 * the answer may still have been committed, so the caller must read the owned
 * thread back rather than sending the paid request again.
 */
export type StudioAnswerOutcome =
  | { kind: 'reply'; reply: StudioLiveReply }
  | { kind: 'pending' }
  | { kind: 'error'; error: string }
  | { kind: 'unconfirmed' }

export type StudioAnswerInput = {
  prompt: string
  platforms: string[]
  language: 'en' | 'zh-HK'
  threadId: string
  position: number
  attachedSourceId?: string
}

/** Buffered replies (flag off, replay, pre-stream errors) stay JSON; only SSE is parsed as events. */
async function readBufferedOutcome(response: Response): Promise<StudioAnswerOutcome> {
  const data = await response.json().catch(() => null) as { error?: unknown } | null
  if (response.ok && data) return { kind: 'reply', reply: data as StudioLiveReply }
  const error = typeof data?.error === 'string' ? data.error : 'STUDIO_UNAVAILABLE'
  return error === 'STUDIO_ANSWER_PENDING' ? { kind: 'pending' } : { kind: 'error', error }
}

/**
 * Posts one Studio answer request and, when the server answers with SSE, hands
 * every delta to `onDelta` in arrival order. The terminal `done` payload is the
 * same reply the buffered route returns, so callers keep one completion path.
 */
export async function requestStudioAnswer({ clientId, input, signal, onDelta }: {
  clientId: string
  input: StudioAnswerInput
  signal: AbortSignal
  onDelta: (platform: string, text: string) => void
}): Promise<StudioAnswerOutcome> {
  const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId)}/studio/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    cache: 'no-store',
    body: JSON.stringify(input),
    signal,
  })
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream') || !response.body) return readBufferedOutcome(response)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let event = ''
  let data: string[] = []
  let outcome: StudioAnswerOutcome | null = null

  const dispatch = (): boolean => {
    const name = event || 'message'
    const payload = data.join('\n')
    event = ''
    data = []
    if (!payload) return false
    let frame: unknown
    try { frame = JSON.parse(payload) } catch { return false }
    if (name === 'delta') {
      const delta = frame as { platform?: unknown; text?: unknown }
      if (typeof delta.platform === 'string' && typeof delta.text === 'string') onDelta(delta.platform, delta.text)
      return false
    }
    if (name === 'done') { outcome = { kind: 'reply', reply: frame as StudioLiveReply }; return true }
    if (name === 'error') {
      const error = (frame as { error?: unknown }).error
      outcome = { kind: 'error', error: typeof error === 'string' ? error : 'STUDIO_UNAVAILABLE' }
      return true
    }
    return false
  }

  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
        if (!line) { if (dispatch()) return outcome!; continue }
        if (line.startsWith(':')) continue
        if (line.startsWith('event:')) event = line.slice('event:'.length).trim()
        else if (line.startsWith('data:')) data.push(line.slice('data:'.length).trim())
      }
    }
    // The final frame may omit its trailing blank line.
    if (!outcome && dispatch()) return outcome!
  } catch {
    // A partially read stream is not a completed answer; the caller reads back.
    return { kind: 'unconfirmed' }
  } finally {
    reader.releaseLock?.()
  }
  return outcome ?? { kind: 'unconfirmed' }
}
