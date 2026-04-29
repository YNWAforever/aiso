import { NextRequest, NextResponse } from 'next/server'
import { computeAuthority } from '@/lib/authority/aggregator'
import type { IndustryCode, RegionCode } from '@/lib/types'

export async function POST(req: NextRequest) {
  const body = await req.json() as { urls?: string[]; industry?: string; region?: string }
  const { urls, industry = 'general_b2c', region = 'global' } = body

  if (!Array.isArray(urls) || !urls.length) {
    return NextResponse.json({ error: 'urls array required' }, { status: 400 })
  }
  if (urls.length > 100) {
    return NextResponse.json({ error: 'max 100 URLs per request' }, { status: 400 })
  }

  const results = await Promise.allSettled(
    urls.map(async (url: string) => {
      const domain = new URL(url.startsWith('http') ? url : `https://${url}`).hostname
      const r = await computeAuthority(domain, industry as IndustryCode, region as RegionCode)
      return { domain, ...r }
    })
  )

  return NextResponse.json({
    results: results.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { url: urls[i], error: 'failed' }
    ),
  })
}
