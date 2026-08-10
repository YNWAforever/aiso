import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CLAIM_INTENT_COOKIE, signScanClaimIntent } from '@/lib/security/scan-claim-intent'
import { consumePublicScanRateLimit } from '@/lib/security/public-scan-rate-limit'
import { getE2EScanFixture } from '@/lib/e2e-fixtures'

export const dynamic = 'force-dynamic'

function parseLanguage(body: unknown): 'en' | 'zh-HK' | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const lang = (body as Record<string, unknown>).lang
  return lang === 'en' || lang === 'zh-HK' ? lang : null
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

  try {
    const rateLimit = await consumePublicScanRateLimit(req)
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(Math.max(1, rateLimit.resetAt - Math.floor(Date.now() / 1000))) } },
      )
    }
  } catch {
    console.error('[scan-claim-intent] rate-limit-failed')
    return NextResponse.json({ error: 'Unable to prepare scan claim' }, { status: 503 })
  }

  try {
    const rows = await db()`select id, account_id from scans where id = ${id} limit 1`
    const scan = rows[0] as { id: string; account_id: string | null } | undefined
    if (!scan) return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
    if (scan.account_id !== null) return NextResponse.json({ error: 'Scan already belongs to an account' }, { status: 409 })

    return createIntentResponse(scan.id, lang)
  } catch {
    console.error('[scan-claim-intent] scan-lookup-failed')
    return NextResponse.json({ error: 'Unable to prepare scan claim' }, { status: 500 })
  }
}
