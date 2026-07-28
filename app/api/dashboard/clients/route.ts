import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { createBrandForAccount } from '@/lib/brands/create'

export const dynamic = 'force-dynamic'

// POST /api/dashboard/clients — self-service brand creation
export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { brand_name, domain, industry, competitors } = body

  if (!brand_name || typeof brand_name !== 'string') {
    return NextResponse.json({ error: 'brand_name required' }, { status: 400 })
  }

  try {
    const result = await createBrandForAccount({
      accountId: profile.account_id,
      brandName: brand_name,
      domain,
      industry,
      competitors,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason, plan: result.plan, limit: result.limit },
        { status: 403 },
      )
    }

    return NextResponse.json({ id: result.clientId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Brand creation failed:', message.replace(/postgresql:\/\/\S+/g, '[redacted]'))
    return NextResponse.json({ error: 'Failed to create brand' }, { status: 500 })
  }
}
