import { NextResponse, after, type NextRequest } from 'next/server'

import { appOrigin } from '@/lib/app-origin'
import { db } from '@/lib/db'
import { selectPendingClients } from '@/lib/pulse/schedule'

export const dynamic = 'force-dynamic'

/**
 * How far the chain may run before it stops on its own.
 *
 * A full week is roughly (clients x ceil(prompts / DEFAULT_CHUNK)) steps — about
 * 8 per client at the 24 prompts onboarding seeds. 200 covers ~25 clients in one
 * chain; beyond that the next daily firing picks up where this left off, because
 * progress lives in the data rather than in the chain.
 *
 * It exists to bound cost if a bug ever makes "work remaining" permanently true.
 */
const MAX_CHAIN = 200

/** Stop starting new work with less than this left, so the in-flight chunk lands. */
const BUDGET_MS = 45_000

/**
 * Drives the chunked Pulse producer.
 *
 * Vercel Cron and `/api/pulse/run` have incompatible shapes, which is the whole
 * reason this route exists:
 *
 *   Vercel Cron  ->  GET, `Authorization: Bearer $CRON_SECRET`, no body
 *   pulse/run    ->  POST, `x-cron-secret`, `{ clientId, cursor }`
 *
 * So the same secret is read from one header here and sent in a different one
 * below. That looks like a bug and is not: the inbound shape is Vercel's, the
 * outbound shape is the producer's, and neither is ours to choose.
 *
 * **Re-entrant, because it has to be.** A driver that looped a client's ~8
 * chunks to completion would need several minutes; the platform ceiling is 60s
 * (and vercel.json holds every function at or under it, so the config needs no
 * assumption about the plan). Each invocation therefore does what fits its
 * budget and then chains: `after()` fires the next hop once the response is
 * sent, so the work continues in a fresh invocation with a fresh budget rather
 * than racing this one's clock.
 *
 * A broken link is not a stall. Progress is derived from the data — see
 * selectPendingClients — so the next daily firing resumes exactly where the
 * chain stopped, with nothing to reconcile.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || cronSecret.length < 16) {
    console.error('[cron/pulse] CRON_SECRET is unset or shorter than 16 characters')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  // Vercel attaches this automatically when CRON_SECRET is set on the project.
  // Compared against a known-present secret, so an unset var can never make an
  // absent header match — the pre-fence trial-emails route compared against
  // `Bearer undefined` and would have accepted that literal string.
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const hop = Number(url.searchParams.get('hop') ?? '0')
  if (!Number.isFinite(hop) || hop < 0 || hop >= MAX_CHAIN) {
    return NextResponse.json({ error: 'Chain limit reached', hop }, { status: 200 })
  }

  const startedAt = Date.now()
  let pending: Awaited<ReturnType<typeof selectPendingClients>>
  try {
    pending = await selectPendingClients(db(), 1)
  } catch {
    console.error('[cron/pulse] pending-client lookup failed')
    return NextResponse.json({ error: 'Lookup failed' }, { status: 503 })
  }

  if (pending.length === 0) {
    return NextResponse.json({ done: true, hop, processed: 0 })
  }

  const target = pending[0]
  let result: { processed?: number; nextCursor?: number | null } = {}
  try {
    const res = await fetch(`${appOrigin()}/api/pulse/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': cronSecret },
      body: JSON.stringify({ clientId: target.clientId, cursor: target.cursor }),
    })
    if (!res.ok) {
      // Do not chain past a failing client — it would spin the whole budget on
      // the same error. The next firing retries it from the same derived cursor.
      console.error(`[cron/pulse] producer returned ${res.status} for ${target.clientId}`)
      return NextResponse.json(
        { error: 'Producer failed', status: res.status, clientId: target.clientId },
        { status: 502 },
      )
    }
    result = await res.json()
  } catch {
    console.error('[cron/pulse] producer call failed')
    return NextResponse.json({ error: 'Producer unreachable' }, { status: 502 })
  }

  // Chain only if there is budget left to be worth another hop. `after()` runs
  // once the response is sent, so this invocation is not holding the connection
  // open for its successor.
  const moreWork = result.nextCursor !== null || pending.length > 0
  const chained = moreWork && Date.now() - startedAt < BUDGET_MS
  if (chained) {
    const next = new URL('/api/cron/pulse', appOrigin())
    next.searchParams.set('hop', String(hop + 1))
    after(async () => {
      try {
        await fetch(next, { headers: { authorization: `Bearer ${cronSecret}` } })
      } catch {
        // A dropped link costs throughput, not correctness: the next scheduled
        // firing resumes from the same derived progress.
        console.error('[cron/pulse] chain hop failed')
      }
    })
  }

  return NextResponse.json({
    hop,
    clientId: target.clientId,
    cursor: target.cursor,
    processed: result.processed ?? 0,
    nextCursor: result.nextCursor ?? null,
    chained,
  })
}
