import { NextRequest, NextResponse } from 'next/server'
import { authLocale } from '@/lib/auth-return-to'
import { getProfile } from '@/lib/auth'
import { readLimitedJson } from '@/lib/approvals/request'
import { completeOnboarding } from '@/lib/onboarding/service'
import { parseOnboardingInput } from '@/lib/onboarding/schema'
import { readOnboardingProgress, ownedOnboardingScan } from '@/lib/onboarding/store'
import { claimScanForAccount } from '@/app/api/scans/[id]/claim/route'
import { CLAIM_INTENT_COOKIE, authorizedScanClaimIntent } from '@/lib/security/scan-claim-intent'
import { consumeScanClaimAttempt } from '@/lib/security/scan-claim-attempt'

export const dynamic = 'force-dynamic'
export async function POST(req: NextRequest) {
  let locale: 'en' | 'zh-HK' = 'en'
  let input: ReturnType<typeof parseOnboardingInput>
  try {
    const raw = await readLimitedJson(req, 16384)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid JSON')
    const body = raw as Record<string, unknown>
    locale = authLocale(typeof body.locale === 'string' ? body.locale : '')
    input = parseOnboardingInput(body)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid JSON' }, { status: 400 })
  }
  try {
    const profile = await getProfile()
    if (!profile) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
    const accountId = profile.account_id
    const scope = { accountId, locale }
    const scanId = input.scanId
    const saved = await readOnboardingProgress(scope, input.intentKey)
    if (scanId && !(saved?.scanId === scanId && (input.clientId === null || saved.clientId === input.clientId))
      && !await ownedOnboardingScan(scope, scanId)) {
      const intent = authorizedScanClaimIntent(req.cookies.get(CLAIM_INTENT_COOKIE)?.value, scanId)
      if (!intent) return NextResponse.json({ error: 'Claim unavailable' }, { status: 403 })
      if (await consumeScanClaimAttempt(intent.attemptId, scanId) !== 'consumed') {
        return NextResponse.json({ error: 'Claim unavailable' }, { status: 403 })
      }
      const claim = await claimScanForAccount(scanId, accountId)
      if (claim.status === 'not-found') return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
      if (claim.status === 'conflict') return NextResponse.json({ error: 'Scan belongs to another account' }, { status: 409 })
      if (claim.status === 'error') return NextResponse.json({ error: 'Failed to claim scan' }, { status: 500 })
    }

    const result = await completeOnboarding(scope, input)
    if (!result) return NextResponse.json({ error: 'Onboarding target unavailable' }, { status: 404 })
    const reportScanId = scanId && await ownedOnboardingScan(scope, scanId, result.clientId) ? scanId : null
    return NextResponse.json({ ...result, reportScanId }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if(error instanceof Error&&error.message==='ONBOARDING_INTENT_CONFLICT')return NextResponse.json({error:'ONBOARDING_INTENT_CONFLICT'},{status:409})
    if (error instanceof Error && error.message.includes('BRAND_LIMIT_REACHED')) {
      return NextResponse.json({ error: 'BRAND_LIMIT_REACHED' }, { status: 403 })
    }
    return NextResponse.json({ error: 'ONBOARDING_UNAVAILABLE' }, { status: 503 })
  }
}
