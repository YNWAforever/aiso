import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { readLimitedJson } from '@/lib/approvals/request'
import { parseDomainCheckInput, checkPublicHomepage } from '@/lib/domain-check/check'
import { DOMAIN_CHECK_LIMIT, consumeDomainCheckLimit } from '@/lib/domain-check/limit'
import { buildRateLimitHeaders } from '@/lib/security/durable-rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export async function POST(request: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  let input: ReturnType<typeof parseDomainCheckInput>
  try {
    input = parseDomainCheckInput(await readLimitedJson(request, 2048))
  } catch {
    return NextResponse.json({ error: 'INVALID_DOMAIN_INPUT' }, { status: 400 })
  }
  try {
    const decision = await consumeDomainCheckLimit(profile.account_id)
    const headers = buildRateLimitHeaders(DOMAIN_CHECK_LIMIT, decision)
    headers.set('Cache-Control', 'no-store')
    if (!decision.allowed) return NextResponse.json({ error: 'DOMAIN_CHECK_LIMIT' }, { status: 429, headers })
    const result = await checkPublicHomepage(input)
    return NextResponse.json(result, { headers })
  } catch {
    // A provider or database failure must not echo page content or credentials.
    return NextResponse.json({ error: 'DOMAIN_CHECK_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
