import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params

  const secret = req.headers.get('x-cron-secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { scanId, progress } = body as {
    scanId?: string
    progress?: Array<{
      platform: string; metric: string; currentValue: number
      previousValue?: number | null; delta?: number | null
    }>
  }

  if (!scanId || !Array.isArray(progress)) {
    return NextResponse.json({ error: 'scanId and progress array required' }, { status: 400 })
  }

  const { data: scan, error: scanErr } = await supabase
    .from('scans').select('id').eq('id', scanId).single()
  if (scanErr || !scan) {
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
  }

  if (progress.length === 0) {
    return NextResponse.json({ count: 0 })
  }

  const rows = progress.map(p => ({
    scan_id: scanId,
    platform: p.platform,
    metric: p.metric,
    current_value: p.currentValue,
    previous_value: p.previousValue ?? null,
    delta: p.delta ?? (p.previousValue != null ? p.currentValue - p.previousValue : null),
  }))

  const { error } = await supabase
    .from('agent_progress')
    .upsert(rows, { onConflict: 'scan_id,platform,metric' })

  if (error) {
    return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })
  }

  return NextResponse.json({ count: rows.length })
}
