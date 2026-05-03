import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params

  // Security guard — match existing cron/evaluate-alerts pattern
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Cron not configured' }, { status: 500 })
  }
  const incomingSecret = req.headers.get('x-cron-secret')
  if (!incomingSecret || incomingSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { scanId, recommendations } = body as {
    scanId?: string
    recommendations?: Array<{
      platform: string; category: string; priority: string
      recommendation: string; impactScore: number
    }>
  }

  if (!scanId || !Array.isArray(recommendations)) {
    return NextResponse.json({ error: 'scanId and recommendations array required' }, { status: 400 })
  }

  // Verify scan exists and belongs to this client
  const { data: scan, error: scanErr } = await supabase
    .from('scans').select('id,account_id').eq('id', scanId).single()
  if (scanErr || !scan) {
    return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
  }

  if (recommendations.length === 0) {
    return NextResponse.json({ count: 0 })
  }

  const rows = recommendations.map(r => ({
    scan_id: scanId,
    platform: r.platform,
    category: r.category,
    priority: r.priority,
    recommendation: r.recommendation,
    impact_score: r.impactScore,
  }))

  const { error } = await supabase
    .from('agent_recommendations')
    .upsert(rows, { onConflict: 'scan_id,platform,category' })

  if (error) {
    return NextResponse.json({ error: 'Database error', detail: error.message }, { status: 500 })
  }

  // Mark agent_status as 'running' on first data, then check if all 3 tables have data
  await supabase.from('scans')
    .update({ agent_status: 'running' })
    .eq('id', scanId)
    .in('agent_status', ['pending', null])

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
