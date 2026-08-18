import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CLAIM_INTENT_COOKIE, signScanClaimIntent } from '@/lib/security/scan-claim-intent'
import { consumePublicScanRateLimit } from '@/lib/security/public-scan-rate-limit'
import { getE2EScanFixture } from '@/lib/e2e-fixtures'
import { redactSecrets } from '@/lib/security/redact-secrets'

export const dynamic = 'force-dynamic'

function parseLanguage(body: unknown): 'en' | 'zh-HK' | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const lang = (body as Record<string, unknown>).lang
  return lang === 'en' || lang === 'zh-HK' ? lang : null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * scans.id is a strict `uuid` column. Without this check a malformed id --
 * a bot probing this public route, a stray path segment -- reached the query
 * unvalidated, Postgres raised "invalid input syntax for type uuid", and the
 * blanket catch below turned that into an opaque 500 with the real cause
 * discarded. Rejecting the shape up front turns that into an honest 400.
 */
function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

function createIntentResponse(scanId: string, lang: 'en' | 'zh-HK') {
  const token = signScanClaimIntent({
    scanId,
    lang,
    returnPath: `/${lang}/result/${scanId}?claim=1`,
    attemptId: crypto.randomUUID(),
  })
  const response = NextResponse.json({ ok: true })
  response.cookies.set(CLAIM_INTENT_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 15 * 60,
    path: '/',
  })
  return response
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const lang = parseLanguage(body)
  if (!lang) return NextResponse.json({ error: 'Invalid language' }, { status: 400 })

  const { id } = await params
  if (getE2EScanFixture(id)) return createIntentResponse(id, lang)
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid scan id' }, { status: 400 })

  try {
    const rateLimit = await consumePublicScanRateLimit(req)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, rateLimit.resetAt - Math.floor(Date.now() / 1000))) } },
      )
    }
  } catch (err) {
    // Redacted even though this path never touches a connection string today:
    // the isUuid guard above already closes the one known cause of a thrown
    // error here, so an occurrence now means something unanticipated, and an
    // unanticipated error is exactly the kind that shouldn't be trusted to be
    // DSN-free. Bare `catch {}` previously discarded this and every other
    // cause of a 500 here, which is why the 2026-08-14 occurrences of this
    // exact error were undiagnosable from logs alone.
    console.error('[scan-claim-intent] rate-limit-failed', redactSecrets(String(err)))
    return NextResponse.json({ error: 'Unable to prepare scan claim' }, { status: 503 })
  }

  try {
    const rows = await db()`select id, account_id from scans where id = ${id} limit 1`
    const scan = rows[0] as { id: string; account_id: string | null } | undefined
    if (!scan) return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
    if (scan.account_id !== null) return NextResponse.json({ error: 'Scan already belongs to an account' }, { status: 409 })

    return createIntentResponse(scan.id, lang)
  } catch (err) {
    console.error('[scan-claim-intent] scan-lookup-failed', redactSecrets(String(err)))
    return NextResponse.json({ error: 'Unable to prepare scan claim' }, { status: 500 })
  }
}
