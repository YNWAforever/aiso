import { getProfile } from '@/lib/auth'
import { beginSummaryExecution, finishSummaryExecution, readOwnedSummary } from '@/lib/n8n/store'
import { parseExecutionIdentity, parseSummaryCompletion, tokenPattern, uuid } from '@/lib/n8n/schema'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }
type Context = { params: Promise<{ id: string }> }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers })

async function boundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error('INVALID_BODY')
  const reader = request.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 16_384) { await reader.cancel(); throw new Error('BODY_TOO_LARGE') }
      chunks.push(value)
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } finally { reader.releaseLock() }
}
/** Existing account owners can inspect receipts; anonymous callers cannot enumerate scans. */
export async function GET(_request: Request, context: Context) {
  try {
    const profile = await getProfile()
    if (!profile) return json({ error: 'Unauthenticated' }, 401)
    const { id } = await context.params
    if (!uuid.test(id)) return json({ error: 'Not found' }, 404)
    const receipt = await readOwnedSummary({ scanId: id, accountId: profile.account_id })
    return receipt ? json({ scanId: id, receipt }) : json({ error: 'Not found' }, 404)
  } catch { return json({ error: 'RECEIPT_UNAVAILABLE' }, 503) }
}
/** A short-lived per-scan capability authorizes only this frozen summary execution. */
export async function POST(request: Request, context: Context) {
  const authorization = request.headers.get('authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (!tokenPattern.test(token)) return json({ error: 'Unauthorized' }, 401)
  let body: unknown
  try { body = await boundedJson(request) } catch (error) {
    return json({ error: 'Invalid receipt' }, error instanceof Error && error.message === 'BODY_TOO_LARGE' ? 413 : 400)
  }
  const { id } = await context.params
  const identity = parseExecutionIdentity(id, body)
  if (!identity || !body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Invalid receipt' }, 400)
  const phase = (body as Record<string, unknown>).phase
  try {
    if (phase === 'start') {
      const result = await beginSummaryExecution(identity, token)
      return json({ scanId: id, dispatchId: identity.dispatchId, executionId: identity.executionId, workflowId: identity.workflowId,
        mayProcess: result.mayProcess, receipt: result.receipt, ...(result.input ? { input: result.input } : {}) }, result.status)
    }
    const completion = parseSummaryCompletion(body)
    if (!completion) return json({ error: 'Invalid receipt' }, 400)
    const result = await finishSummaryExecution(identity, token, completion)
    return json({ scanId: id, receipt: result.receipt }, result.status)
  } catch {
    // A failed read/write cannot be acknowledged as persisted success.
    return json({ error: 'RECEIPT_UNAVAILABLE' }, 503)
  }
}
