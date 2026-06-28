import { getProfile } from '@/lib/auth'
import { upsertLocalTrustProfile, verifyClientOwnership } from '@/lib/localTrust/store'
import { planAllows } from '@/lib/tier'

function textArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(item => String(item).trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 10)
}

function nullableText(value: unknown): string | null {
  const text = String(value ?? '').trim().slice(0, 160)
  return text ? text : null
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : null
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const plan = profile.accounts?.plan ?? 'basic'
  if (!planAllows(plan, 'local_trust_roi')) {
    return Response.json({ error: 'UPGRADE_REQUIRED', feature: 'local_trust_roi', plan }, { status: 403 })
  }

  const client = await verifyClientOwnership(clientId, profile.account_id)
  if (!client) return Response.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const closeRate = nullableNumber(body.close_rate)
  if (closeRate !== null && closeRate > 1) {
    return Response.json({ error: 'close_rate must be between 0 and 1' }, { status: 400 })
  }

  try {
    const data = await upsertLocalTrustProfile({
      clientId,
      accountId: profile.account_id,
      primaryServices: textArray(body.primary_services),
      serviceArea: nullableText(body.service_area),
      averageLeadValue: nullableNumber(body.average_lead_value),
      closeRate,
      competitors: textArray(body.competitors),
    })

    return Response.json({ profile: data })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Profile update failed' }, { status: 500 })
  }
}
