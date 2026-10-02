import { NextRequest, NextResponse } from 'next/server'
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
  let input: ReturnType<typeof parseOnboardingInput>
  try {
    const raw = await readLimitedJson(req, 16384)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid JSON')
    input = parseOnboardingInput(raw as Record<string, unknown>)
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid JSON' }, { status: 400 })
  }
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 })
  const accountId = profile.account_id,
    scope = { accountId },
    scanId = input.scanId
  try {
    const saved = await readOnboardingProgress(scope, input.intentKey)
    if (scanId && !(saved?.scanId === scanId && (input.clientId === null || saved.clientId === input.clientId))) {
      // scanId arrives in the request body, so it is caller-supplied and proves
      // nothing. This is the second claim path into claimScanForAccount and it
      // used to skip the intent entirely, making it a wider version of the hole
      // closed in /api/scans/[id]/claim: post any unowned scan id, own it. Same
      // predicate, same denial.
      const intent = authorizedScanClaimIntent(req.cookies.get(CLAIM_INTENT_COOKIE)?.value, scanId)
      if (!intent) {
        return NextResponse.json({ error: 'Claim unavailable' }, { status: 403 })
      }
      // Single-use (AC-03), spent before the effect. Both claim paths share one
      // cookie, so consuming in only one of them would leave the other as the
      // replay route — the same asymmetry that made this path the wider hole
      // before the intent check was added here at all.
      // A request can stop after claiming the scan but before persisting setup.
      // Its signed intent plus session-owned readback permits resuming that setup
      // without trying to spend the single-use claim again.
      if (!(await ownedOnboardingScan(scope, scanId))) {
        let attempt: Awaited<ReturnType<typeof consumeScanClaimAttempt>>
        try {
          attempt = await consumeScanClaimAttempt(intent.attemptId, scanId)
        } catch {
          return NextResponse.json({ error: 'Claim unavailable' }, { status: 503 })
        }
        if (attempt !== 'consumed') {
          return NextResponse.json({ error: 'Claim unavailable' }, { status: 403 })
        }
        const claim = await claimScanForAccount(scanId, accountId)
        if (claim.status === 'not-found') return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
        if (claim.status === 'conflict')
          return NextResponse.json({ error: 'Scan belongs to another account' }, { status: 409 })
        if (claim.status === 'error') return NextResponse.json({ error: 'Failed to claim scan' }, { status: 500 })
      }
    }

    const result = await completeOnboarding(scope, input)
    if (!result) return NextResponse.json({ error: 'Onboarding target unavailable' }, { status: 404 })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof Error && error.message.includes('BRAND_LIMIT_REACHED')) {
      return NextResponse.json({ error: 'BRAND_LIMIT_REACHED' }, { status: 403 })
    }
    return NextResponse.json({ error: 'ONBOARDING_UNAVAILABLE' }, { status: 503 })
  }
}
