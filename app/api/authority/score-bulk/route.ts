import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { computeAuthority } from '@/lib/authority/aggregator'
import type { IndustryCode, RegionCode } from '@/lib/types'

// Each URL fans out to several outbound requests, so an unbounded batch is an
// amplification vector even for an authenticated caller.
const MAX_URLS = 50

export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { urls?: string[]; industry?: string; region?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { urls, industry = 'general_b2c', region = 'global' } = body

  if (!Array.isArray(urls) || !urls.length) {
    return NextResponse.json({ error: 'urls array required' }, { status: 400 })
  }
  if (urls.length > MAX_URLS) {
    return NextResponse.json({ error: `max ${MAX_URLS} URLs per request` }, { status: 400 })
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
