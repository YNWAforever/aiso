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
  const { scanId, competitors } = body as {
    scanId?: string
    competitors?: Array<{
      platform: string; competitorDomain: string; competitorName?: string
      mentionRate: number; yourRate: number; gapAnalysis: string
    }>
  }

  if (!scanId || !Array.isArray(competitors)) {
    return NextResponse.json({ error: 'scanId and competitors array required' }, { status: 400 })
  }

  const { data: scan, error: scanErr } = await supabase
    .from('scans').select('id').eq('id', scanId).single()
  if (scanErr || !scan) {
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
  }

  if (competitors.length === 0) {
    return NextResponse.json({ count: 0 })
  }

  const rows = competitors.map(c => ({
    scan_id: scanId,
    platform: c.platform,
    competitor_domain: c.competitorDomain,
    competitor_name: c.competitorName ?? null,
    mention_rate: c.mentionRate,
    your_rate: c.yourRate,
    gap_analysis: c.gapAnalysis,
  }))

  const { error } = await supabase
    .from('agent_competitors')
    .upsert(rows, { onConflict: 'scan_id,platform,competitor_domain' })

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
