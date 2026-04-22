import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> },
) {
  const { clientId } = await params

  const { data, error } = await supabase
    .from('pulse_weekly_summary')
    .select('*')
    .eq('client_id', clientId)
    .order('scan_week', { ascending: true })
    .limit(8)

  if (error) return NextResponse.json({ error: 'DB error' }, { status: 500 })
  return NextResponse.json(data)
}
