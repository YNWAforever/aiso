import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
  }
  const incomingSecret = req.headers.get('x-cron-secret')
  if (!incomingSecret || incomingSecret !== cronSecret) {
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

  // Check if all 3 agent tables have data — if so, mark complete
  const [{ count: recsCount }, { count: progCount }, { count: compsCount }] = await Promise.all([
    supabase.from('agent_recommendations').select('*', { count: 'exact', head: true }).eq('scan_id', scanId),
    supabase.from('agent_progress').select('*', { count: 'exact', head: true }).eq('scan_id', scanId),
    supabase.from('agent_competitors').select('*', { count: 'exact', head: true }).eq('scan_id', scanId),
  ])

  if (recsCount && recsCount > 0 && progCount && progCount > 0 && compsCount && compsCount > 0) {
    await supabase.from('scans').update({ agent_status: 'complete' }).eq('id', scanId)
  }

  return NextResponse.json({ count: rows.length })
}
