import { NextRequest, NextResponse, after } from 'next/server'
import { authorizeAiTool, consumeAiToolAllowance } from '@/lib/fix/guard'
import { buildGroundedFixPack, type GroundedFixPack } from '@/lib/fix/grounded-pack'
import { reportFixPackUsage, storeFixPack } from '@/lib/billing/usage'
import { db } from '@/lib/db'
import { fetchPublicUrl } from '@/lib/security/public-url'
import type { Scan } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Retained for callers parsing the existing three-file response format.
export function parseFixPack(raw: string): GroundedFixPack {
  const match = raw.match(/\{[\s\S]*\}/)
  return JSON.parse(match?.[0] ?? raw)
}

async function canAccessScan(scanId: string, accountId: string): Promise<boolean> {
  const rows = await db()`
    select id from scans
    where id = ${scanId}
      and (account_id is null or account_id = ${accountId})
    limit 1
  `
  return rows.length > 0
}

export async function POST(req: NextRequest) {
  const access = await authorizeAiTool({ paidOnly: false })
  if (!access.ok) return access.response
  const { scanId } = await req.json()
  if (!scanId) return NextResponse.json({ error: 'Missing scanId' }, { status: 400 })

  try {
    if (!await canAccessScan(scanId, access.accountId)) {
      return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
    }
  } catch (error) {
    console.error('[fix] ownership check failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  let scan: Scan | null
  let existing: GroundedFixPack | null
  try {
    const cacheRows = await db()`
      select f.llms_txt, f.robots_patch, f.faq_schema from fix_packs f
      join scans s on s.id = f.scan_id
      where f.scan_id = ${scanId}
        and (s.account_id is null or s.account_id = ${access.accountId})
      order by f.created_at desc, f.id desc
      limit 1
    `
    existing = (cacheRows[0] ?? null) as GroundedFixPack | null
    const scanRows = await db()`
      select * from scans where id = ${scanId}
        and (account_id is null or account_id = ${access.accountId}) limit 1
    `
    scan = (scanRows[0] ?? null) as Scan | null
  } catch (error) {
    console.error('[fix] cache/scan lookup failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }
  if (!scan) return NextResponse.json({ error: 'Scan not found' }, { status: 404 })

  // Rebuild from bounded, DNS-pinned source evidence. A legacy cache or a free-form
  // model response cannot license statements about pages, FAQs or access policy.
  let html = ''
  try {
    const response = await fetchPublicUrl(scan.url, { signal: AbortSignal.timeout(8000) })
    if (response.ok) html = await response.text()
  } catch { /* Missing evidence produces explicitly incomplete drafts. */ }
  const pack = buildGroundedFixPack(scan.url, html)
  if (existing && existing.llms_txt === pack.llms_txt
    && existing.robots_patch === pack.robots_patch && existing.faq_schema === pack.faq_schema) {
    return NextResponse.json(pack)
  }

  const overAllowance = await consumeAiToolAllowance(access.accountId)
  if (overAllowance) return overAllowance

  let usageId: string | null
  try {
    const stored = await storeFixPack(access.accountId, scanId, pack)
    if (!stored.available) return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
    usageId = stored.usageId
  } catch {
    console.error('[fix] Fix Pack transaction failed')
    // Unassigned scans cannot generate a metered event. For assigned scans,
    // require a positive read before offering a draft after a failed commit.
    if (scan.account_id && scan.client_id) {
      try {
        const [billing] = await db()`select mode from account_billing where account_id = ${access.accountId}::uuid`
        if (billing?.mode === 'metered') return NextResponse.json({ error: 'FIX_PACK_RETRY' }, { status: 503 })
      } catch {
        return NextResponse.json({ error: 'FIX_PACK_RETRY' }, { status: 503 })
      }
    }
    return NextResponse.json(pack)
  }
  if (usageId) {
    const eventId = usageId
    try {
      after(async () => {
        try { await reportFixPackUsage(eventId) } catch { console.error('[fix] meter result could not be stored') }
      })
    } catch {
      console.error('[fix] meter report could not be scheduled')
    }
  }
  return NextResponse.json(pack)
}
