import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { readLimitedJson } from '@/lib/approvals/request'
import { parseBrandAssistInput, generateBrandDraft } from '@/lib/onboarding/brand-assistant'
import { ASSISTANT_LIMIT, consumeAssistantLimit } from '@/lib/onboarding/assistant-limit'
import { buildRateLimitHeaders } from '@/lib/security/durable-rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
export async function POST(request: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'UNAUTHENTICATED' }, { status: 401 })
  let input: ReturnType<typeof parseBrandAssistInput>
  try { input = parseBrandAssistInput(await readLimitedJson(request, 4096)) }
  catch { return NextResponse.json({ error: 'INVALID_BRAND_INPUT' }, { status: 400 }) }
  try {
    const decision = await consumeAssistantLimit(profile.account_id)
    const headers = buildRateLimitHeaders(ASSISTANT_LIMIT, decision)
    headers.set('Cache-Control', 'no-store')
    if (!decision.allowed) return NextResponse.json({ error: 'ASSISTANT_LIMIT' }, { status: 429, headers })
    const draft = await generateBrandDraft(input)
    return NextResponse.json(draft, { headers })
  } catch {
    // Raw provider/site/DB messages may include credentials or page content.
    return NextResponse.json({ error: 'ASSISTANT_UNAVAILABLE' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
