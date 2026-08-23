import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { markCompleteIfAllPresent } from '@/lib/agents'

export const dynamic = 'force-dynamic'

type Metric = {
  platform: string
  metric: string
  currentValue: number
  previousValue?: number | null
  delta?: number | null
}

function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return null
  return secret
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params

  const secret = cronSecret()
  if (!secret) {
    console.error('[agents/progress] CRON_SECRET is unset or shorter than 16 characters')
    return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  }
  if (req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { scanId?: string; progress?: Metric[] }
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    body = parsed
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const { scanId, progress } = body
  if (!scanId || !Array.isArray(progress)) {
    return NextResponse.json({ error: 'scanId and progress array required' }, { status: 400 })
  }

  const sql = db()

  let scanFound: boolean
  try {
    const rows = await sql`
      select id from scans where id = ${scanId} and client_id = ${clientId} limit 1
    `
    scanFound = rows.length > 0
  } catch (error) {
    console.error('[agents/progress] scan lookup failed:', error)
    return NextResponse.json({ error: 'Scan lookup failed' }, { status: 503 })
  }
  if (!scanFound) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (progress.length === 0) return NextResponse.json({ count: 0 })

  try {
    for (const p of progress) {
      const previousValue = p.previousValue ?? null
      const delta = p.delta ?? (previousValue != null ? p.currentValue - previousValue : null)
      await sql`
        insert into agent_progress (scan_id, platform, metric, current_value, previous_value, delta)
        values (${scanId}, ${p.platform}, ${p.metric}, ${p.currentValue}, ${previousValue}, ${delta})
        on conflict (scan_id, platform, metric) do update set
          current_value = excluded.current_value,
          previous_value = excluded.previous_value,
          delta = excluded.delta
      `
    }
  } catch (error) {
    console.error('[agents/progress] write failed:', error)
    return NextResponse.json({ error: 'Database error' }, { status: 500 })
  }

  await markCompleteIfAllPresent(sql, scanId)

  return NextResponse.json({ count: progress.length })
}
