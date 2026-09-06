/** Read actual bytes, including whitespace; Content-Length is never trusted. */
export async function readLimitedJson(request: Request, limit: number): Promise<unknown> {
  if (!request.body || request.signal.aborted) throw new Error('INVALID_APPROVAL_INPUT')
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytes = 0
  let text = ''
  const abort = () => { void reader.cancel().catch(() => {}) }
  request.signal.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      const chunk = await reader.read()
      if (request.signal.aborted) throw new Error('INVALID_APPROVAL_INPUT')
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > limit) {
        await reader.cancel().catch(() => {})
        throw new Error('APPROVAL_BODY_TOO_LARGE')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text)
  } catch (error) {
    if (error instanceof Error && error.message === 'APPROVAL_BODY_TOO_LARGE') throw error
    throw new Error('INVALID_APPROVAL_INPUT')
  } finally {
    request.signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}

export function approvalErrorResponse(error: unknown): Response {
  const headers = { 'Cache-Control': 'no-store' }
  const code = error instanceof Error ? error.message : ''
  if (code === 'APPROVAL_BODY_TOO_LARGE') return Response.json({ error: code }, { status: 413, headers })
  if (code === 'INVALID_APPROVAL_INPUT' || code === 'INVALID_CHANGE_SET_INPUT') {
    return Response.json({ error: code }, { status: 400, headers })
  }
  return Response.json({ error: 'APPROVAL_UNAVAILABLE' }, { status: 503, headers })
}
