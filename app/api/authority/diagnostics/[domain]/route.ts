import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { computeAuthority } from '@/lib/authority/aggregator'
import type { IndustryCode, RegionCode } from '@/lib/types'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ domain: string }> }
) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { domain } = await params
  const url = new URL(req.url)
  const industry = (url.searchParams.get('industry') ?? 'general_b2c') as IndustryCode
  const region   = (url.searchParams.get('region') ?? 'global') as RegionCode

  try {
    const result = await computeAuthority(domain, industry, region)
    return NextResponse.json({ domain, industry, region, breakdown: result })
  } catch (err) {
    console.error('authority/diagnostics error:', err)
    return NextResponse.json({ error: 'diagnostics failed' }, { status: 500 })
  }
}
