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

type NumberValidation = { ok: true; value: number | null } | { ok: false; error: string }

function nullableNumber(value: unknown, label: string, max?: number): NumberValidation {
  if (value === null || value === undefined) return { ok: true, value: null }
  if (typeof value === 'string' && value.trim() === '') return { ok: true, value: null }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return { ok: false, error: `${label} must be a number` }
  }

  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) {
    return { ok: false, error: `${label} must be a non-negative number` }
  }
  if (max !== undefined && number > max) {
    return { ok: false, error: `${label} must be between 0 and ${max}` }
  }

  return { ok: true, value: number }
}

async function parseJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
  } catch {
    return null
  }
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

  const body = await parseJson(req)
  if (!body) return Response.json({ error: 'Invalid JSON' }, { status: 400 })

  const averageLeadValue = nullableNumber(body.average_lead_value, 'average_lead_value')
  if (!averageLeadValue.ok) return Response.json({ error: averageLeadValue.error }, { status: 400 })

  const closeRate = nullableNumber(body.close_rate, 'close_rate', 1)
  if (!closeRate.ok) return Response.json({ error: closeRate.error }, { status: 400 })

  try {
    const data = await upsertLocalTrustProfile({
      clientId,
      accountId: profile.account_id,
      primaryServices: textArray(body.primary_services),
      serviceArea: nullableText(body.service_area),
      averageLeadValue: averageLeadValue.value,
      closeRate: closeRate.value,
      competitors: textArray(body.competitors),
    })

    return Response.json({ profile: data })
  } catch {
    return Response.json({ error: 'Profile update failed' }, { status: 500 })
  }
}
