import { getProfile } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function GET() {
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('notifications').select('*')
    .eq('account_id', profile.account_id)
    .order('created_at', { ascending: false }).limit(20)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ notifications: data ?? [] })
}
