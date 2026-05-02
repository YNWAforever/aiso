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

  const { data: scan, error: scanErr } = await supabase
    .from('scans').select('id').eq('id', scanId).single()
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

  await supabase.from('scans').update({ agent_status: 'complete' }).eq('id', scanId)

  return NextResponse.json({ count: rows.length })
}
