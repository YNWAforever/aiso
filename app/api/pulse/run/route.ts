import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { callMultiPlatform } from '@/lib/openrouter'
import { analyseAnswer } from '@/lib/pulse/analysis'
import { citationPlatformFor, runtimePlatformsFor } from '@/lib/pulse/platforms'
import { MAX_PROMPTS } from '@/lib/pulse/limits'
import { computeWeeklySummary } from '@/lib/pulse/summary'
import { resolveCommercialEntitlement, type CommercialAccount } from '@/lib/tier'

export const dynamic = 'force-dynamic'

/**
 * How many prompts one invocation processes.
 *
 * A full bank is 50 prompts × up to 5 platforms, and every platform answer costs
 * a second LLM call to analyse. That is far more than any Vercel function limit
 * allows (Hobby 60s; Pro 300s), so the route is a chunk: the caller drives it
 * with a cursor until nextCursor comes back null, and the summary is computed on
 * that final chunk only.
 *
 * The budget this size is derived from — read it before raising the chunk:
 *
 *   per prompt = platform fan-out (concurrent, bounded by the slowest platform,
 *                30s timeout in callOpenRouter)
 *              + analysis  (concurrent across responses, 15s timeout each)
 *              + writes    (one insert per response, plus citations)
 *              ≈ 10s + 3s + 1s typical, ≈ 45s worst case
 *
 * 3 × ~13s ≈ 40s, inside the 60s vercel.json grants this route with margin for
 * one slow platform. MAX_CHUNK stays higher for a caller that knows its own
 * plan's ceiling. Raising DEFAULT_CHUNK without raising maxDuration reintroduces
 * the timeout this replaced.
 */
const DEFAULT_CHUNK = 3
const MAX_CHUNK = 12

function extractCitedUrls(text: string): string[] {
  const urlPattern = /https?:\/\/[^\s<>"',)]+/g
  return [...new Set(text.match(urlPattern) ?? [])]
}

function positiveInt(value: unknown, fallback: number, max: number): number {
  if (value === undefined || value === null) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return Math.min(max, Math.trunc(parsed))
}

/**
 * Runs one chunk of a client's weekly Pulse scan.
 *
 * Machine-invoked only: the cron secret *is* the authentication, so there is no
 * session and no caller account to own the client. The account is therefore
 * resolved *through* the client — the inverse of the auth → entitlement →
 * ownership order in lib/localTrust/guard.ts, which is the right shape for a
 * user-facing route and inapplicable to one with no user. The entitlement check
 * survives that inversion and doubles as cost control: a plan that grants no
 * platforms is refused before any LLM spend.
 *
 * **Nothing invokes this route.** vercel.json declares no crons and no other
 * caller exists, so Pulse data appears only when something calls this by hand.
 */
export async function POST(req: NextRequest) {
  // Explicit, not incidental. The pre-fence check compared a possibly-undefined
  // env var against a header and failed closed only because a missing header
  // reads as null — one refactor away from an open cron endpoint.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || cronSecret.length < 16) {
    console.error('[pulse/run] CRON_SECRET is unset or shorter than 16 characters')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('x-cron-secret') !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('bad body')
    body = parsed as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const clientId = body.clientId
  if (typeof clientId !== 'string' || !clientId) {
    return NextResponse.json({ error: 'Invalid clientId' }, { status: 400 })
  }
  const cursor = positiveInt(body.cursor, 0, MAX_PROMPTS)
  const chunk = positiveInt(body.limit, DEFAULT_CHUNK, MAX_CHUNK) || DEFAULT_CHUNK

  const sql = db()

  let client: { brand_name: string; competitors: string[]; industry: string | null }
  let platforms: string[]
  try {
    const rows = await sql`
      select c.brand_name, c.industry, c.competitors,
             a.plan, a.status, a.stripe_subscription_id, a.trial_ends_at,
             a.override_plan, a.override_expires_at
      from clients c
      join accounts a on a.id = c.account_id
      where c.id = ${clientId}
      limit 1
    `
    const row = rows[0] as Record<string, unknown> | undefined
    if (!row) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    client = {
      brand_name: String(row.brand_name ?? ''),
      industry: (row.industry as string | null) ?? null,
      competitors: (row.competitors as string[] | null) ?? [],
    }
    // Query only the platforms the plan grants — free gets none, basic one, pro
    // and enterprise all five. Translated out of the entitlement vocabulary,
    // which shares no key with the runtime one; see lib/pulse/platforms.ts.
    const entitlement = resolveCommercialEntitlement(row as CommercialAccount)
    platforms = runtimePlatformsFor(entitlement.features.platform_access)
  } catch {
    // A failed lookup is a database incident, not "no such client" — never let
    // an outage read as a 404.
    console.error('[pulse/run] client lookup failed')
    return NextResponse.json({ error: 'Client lookup failed' }, { status: 503 })
  }

  if (platforms.length === 0) {
    return NextResponse.json({ error: 'PLAN_HAS_NO_PLATFORMS' }, { status: 403 })
  }

  let prompts: Array<{ id: string; question: string; category: string | null }>
  let scanWeek: string
  try {
    // Ordered by id so a cursor is stable across invocations.
    const rows = await sql`
      select id, question, category from prompt_bank
      where client_id = ${clientId} and is_active = true
      order by id
      limit ${MAX_PROMPTS}
    `
    prompts = rows as unknown as typeof prompts

    // Taken from the database, not from JS: date_trunc runs in the session
    // timezone while toISOString() is always UTC, so computing it here and
    // reusing it below is what stops a run near midnight writing metrics into
    // one week and rolling up another.
    const [week] = await sql`select date_trunc('week', now())::date as scan_week`
    scanWeek = String((week as { scan_week: string | Date }).scan_week)
  } catch {
    console.error('[pulse/run] prompt lookup failed')
    return NextResponse.json({ error: 'Prompt lookup failed' }, { status: 503 })
  }

  const slice = prompts.slice(cursor, cursor + chunk)
  const nextCursor = cursor + slice.length < prompts.length ? cursor + slice.length : null
  const pulseRunId = crypto.randomUUID()
  let citations = 0

  try {
    for (const prompt of slice) {
      // A platform outage must not abort the chunk — callMultiPlatform already
      // drops rejected platforms, and this catches a total failure.
      const responses = await callMultiPlatform(
        [{ role: 'user', content: prompt.question }],
        500,
        platforms,
      ).catch(() => [])

      // Clear this prompt's rows for the week before writing them, so
      // reprocessing it replaces rather than accumulates.
      //
      // pulse_metrics has no unique key, so nothing at the schema level stops a
      // second pass doubling a prompt's rows — and total_queries is a count over
      // exactly those rows, so a duplicate inflates sov_score, the number the
      // whole feature reports. That was survivable while nothing invoked this
      // route; with a scheduler driving it, reprocessing is routine (a retried
      // chunk, an explicit cursor, a prompt deactivated mid-week moving the
      // derived cursor back). Doing it here rather than in a migration keeps
      // this correct whether or not the pending ledger ever gets a unique index.
      await sql`
        delete from pulse_metrics
        where client_id = ${clientId}
          and prompt_id = ${prompt.id}
          and scan_week = ${scanWeek}::date
      `

      // Concurrent across responses, not sequential. Each analysis is its own
      // LLM round trip; awaiting them one after another made a single prompt
      // cost the sum of five latencies rather than the largest, which is what
      // put a chunk far outside any function limit. Five platforms is the
      // ceiling, so the added concurrency is bounded.
      const written = await Promise.all(responses.map(async response => {
        // Degrades to a substring match rather than losing the row; see
        // lib/pulse/analysis.ts.
        const analysis = await analyseAnswer({
          answer: response.answer,
          brandName: client.brand_name,
          competitors: client.competitors,
        })

        await sql`
          insert into pulse_metrics (
            client_id, prompt_id, platform, question, raw_answer,
            brand_mentioned, sentiment, mention_position, competitors_mentioned, scan_week
          ) values (
            ${clientId}, ${prompt.id}, ${response.platform}, ${prompt.question}, ${response.answer},
            ${analysis.brandMentioned}, ${analysis.sentiment}, ${analysis.mentionPosition},
            ${analysis.competitorsMentioned}::text[], ${scanWeek}::date
          )
        `

        const citationPlatform = citationPlatformFor(response.platform)
        if (!citationPlatform) return 0

        let logged = 0
        for (const url of extractCitedUrls(response.answer)) {
          let domain: string
          try { domain = new URL(url).hostname } catch { continue }
          await sql`
            insert into ai_citation_log (
              pulse_run_id, client_id, cited_url, cited_domain, platform,
              prompt_industry, prompt_topic, prompt_text, cited_at
            ) values (
              ${pulseRunId}, ${clientId}, ${url}, ${domain}, ${citationPlatform},
              ${client.industry}, ${prompt.category}, ${prompt.question}, now()
            )
          `
          logged += 1
        }
        return logged
      }))

      // Summed from the returned counts rather than mutated inside the callbacks,
      // so the total cannot depend on the interleaving.
      citations += written.reduce((total, n) => total + n, 0)
    }
  } catch {
    // A 2xx must mean the writes happened — the pre-fence route destructured no
    // error and reported counts it had never persisted. Rows already committed
    // are fine: the caller retries this chunk from the same cursor, and the
    // upsert in migration 031 makes the eventual rollup idempotent.
    console.error('[pulse/run] metrics write failed')
    return NextResponse.json({ error: 'Pulse run failed', cursor }, { status: 500 })
  }

  // Roll up only once the bank is exhausted, so the summary describes a whole
  // week rather than a partial one.
  let summary = null
  if (nextCursor === null) {
    try {
      summary = await computeWeeklySummary(sql, { clientId, scanWeek })
    } catch {
      console.error('[pulse/run] summary rollup failed')
      return NextResponse.json({ error: 'Summary rollup failed', cursor }, { status: 500 })
    }
  }

  return NextResponse.json({
    pulseRunId,
    scanWeek,
    processed: slice.length,
    nextCursor,
    citations,
    platforms: platforms.length,
    summary,
  })
}
