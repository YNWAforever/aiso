import { timingSafeEqual } from 'node:crypto'

// ASCII bearer token syntax and a fixed allocation bound apply to both sides.
export function validProbeSecret(secret: string | undefined): secret is string {
  return typeof secret === 'string' && secret.length >= 32 && secret.length <= 1024 && /^[A-Za-z0-9._~+/-]+=*$/.test(secret)
}

export function authorizeProbe(request: Request, secret: string | undefined): boolean {
  if (!validProbeSecret(secret)) return false
  const header = request.headers.get('authorization')
  if (!header || header.length > 1031 || !header.startsWith('Bearer ')) return false
  const token = header.slice(7)
  if (!validProbeSecret(token)) return false
  const candidate = Buffer.from(token, 'ascii')
  const expected = Buffer.from(secret, 'ascii')
  return candidate.length === expected.length && timingSafeEqual(candidate, expected)
}

export class ProbeBodyError extends Error {
  constructor(readonly status: 400 | 413 | 503) { super('Invalid readiness body') }
}

/** Count streamed bytes, ignoring caller-supplied Content-Length. */
export async function readBoundedJson(request: Request, maxBytes = 16384, signal: AbortSignal = request.signal): Promise<unknown> {
  if (signal.aborted) throw new ProbeBodyError(503)
  if (!request.body) throw new ProbeBodyError(400)
  const reader = request.body.getReader()
  let cancelled = false
  const cancel = () => {
    if (cancelled) return
    cancelled = true
    // Cancellation closes pending reads immediately; a source's cleanup promise
    // must not extend the request deadline.
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', cancel, { once: true })
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      if (signal.aborted) throw new ProbeBodyError(503)
      const chunk = await reader.read()
      if (signal.aborted) throw new ProbeBodyError(503)
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) throw new ProbeBodyError(413)
      chunks.push(chunk.value)
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
  } catch (error) {
    if (signal.aborted) throw new ProbeBodyError(503)
    if (error instanceof ProbeBodyError) throw error
    throw new ProbeBodyError(400)
  } finally {
    signal.removeEventListener('abort', cancel)
    cancel()
    reader.releaseLock()
  }
}
