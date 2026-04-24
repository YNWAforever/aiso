import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params

  const { data, error } = await supabase
    .from('pulse_metrics')
    .select('platform, question, competitors_mentioned, scan_week')
    .eq('client_id', clientId)
    .eq('brand_mentioned', false)
    .order('scan_week', { ascending: false })
    .limit(50)

  if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })
  return NextResponse.json(data)
}
