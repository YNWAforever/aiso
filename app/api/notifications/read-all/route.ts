import { getProfile } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'

export async function PUT() {
  const profile = await getProfile()
  if (!profile) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('notifications')
    .update({ read: true }).eq('account_id', profile.account_id).eq('read', false)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
