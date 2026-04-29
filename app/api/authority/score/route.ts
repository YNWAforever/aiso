import { NextRequest, NextResponse } from 'next/server'
import { computeAuthority } from '@/lib/authority/aggregator'
import type { IndustryCode, RegionCode } from '@/lib/types'

export async function POST(req: NextRequest) {
  const body = await req.json() as { url?: string; industry?: string; region?: string }
  const { url, industry = 'general_b2c', region = 'global' } = body
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  let domain: string
  try {
    domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }

  try {
    const result = await computeAuthority(domain, industry as IndustryCode, region as RegionCode)
    return NextResponse.json({ domain, industry, region, ...result })
  } catch (err) {
    console.error('authority/score error:', err)
    return NextResponse.json({ error: 'scoring failed' }, { status: 500 })
  }
}
