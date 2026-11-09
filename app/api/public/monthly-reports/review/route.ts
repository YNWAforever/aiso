import { readLimitedJson } from '@/lib/approvals/request'
import { submitMonthlyReview } from '@/lib/monthly-report/review'

export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 2 * 1024
const HEADERS = { 'Cache-Control': 'no-store' }

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: HEADERS })
}

/**
 * Public: a client's decision on a monthly report version (Phase 3, advisory).
 * The signed review link in the body is the only credential; it is bound to the
 * report's current version, so a decision cannot be moved to another version or
 * report. Writes exactly once — a second decision for the same version is 409,
 * never an overwrite.
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await readLimitedJson(request, MAX_BODY_BYTES)
  } catch {
    return json({ error: 'INVALID_BODY' }, 400)
  }

  let result: Awaited<ReturnType<typeof submitMonthlyReview>>
  try {
    result = await submitMonthlyReview(body)
  } catch {
    // Rate-limit or storage infrastructure failed: refuse rather than record a
    // decision whose ledger we cannot trust.
    return json({ error: 'UNAVAILABLE' }, 503)
  }

  switch (result.state) {
    case 'recorded':
      return json({ decision: result.decision, decidedAt: result.decidedAt }, 201)
    case 'already':
      return json({ error: 'DECISION_RECORDED' }, 409)
    case 'rate_limited':
      return Response.json({ error: 'TOO_MANY_REQUESTS' }, {
        status: 429,
        headers: { ...HEADERS, 'Retry-After': String(Math.max(1, Math.ceil((result.retryAt - Date.now()) / 1000))) },
      })
    case 'not_found':
      return json({ error: 'NOT_FOUND' }, 404)
    default:
      return json({ error: 'INVALID_BODY' }, 400)
  }
}
