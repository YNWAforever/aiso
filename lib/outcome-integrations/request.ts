import { OutcomeError } from './input'

/** Preserve the exact signed UTF-8 representation, but never buffer over limit. */
export async function readOutcomeBody(request: Request, limit = 65536): Promise<string> {
  if (!request.body || request.signal.aborted) throw new OutcomeError('INVALID_OUTCOME_INPUT')
  const reader = request.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0, body = ''
  const abort = () => { void reader.cancel().catch(() => {}) }
  request.signal.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      const chunk = await reader.read()
      if (request.signal.aborted) throw new OutcomeError('INVALID_OUTCOME_INPUT')
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > limit) {
        await reader.cancel().catch(() => {})
        throw new OutcomeError('OUTCOME_BODY_TOO_LARGE', 413)
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } catch (error) {
    if (error instanceof OutcomeError) throw error
    throw new OutcomeError('INVALID_OUTCOME_INPUT')
  } finally { request.signal.removeEventListener('abort', abort); reader.releaseLock() }
}
export async function readOutcomeJson(request: Request): Promise<unknown> {
  const body = await readOutcomeBody(request)
  try { return JSON.parse(body) } catch { throw new OutcomeError('INVALID_OUTCOME_INPUT') }
}
