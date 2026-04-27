import { getProfile } from '@/lib/auth'
import { createServerSupabaseClient } from '@/lib/supabase-server'
import { NotificationBell } from './NotificationBell'

interface Props {
  title: string
  subtitle?: string
}

export async function TopBar({ title, subtitle }: Props) {
  let unreadCount = 0
  try {
    const profile = await getProfile()
    if (profile) {
      const supabase = await createServerSupabaseClient()
      const { count } = await supabase
        .from('notifications').select('*', { count: 'exact', head: true })
        .eq('account_id', profile.account_id).eq('read', false)
      unreadCount = count ?? 0
    }
  } catch { /* non-critical — bell shows 0 */ }

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
      <div>
        <h1 className="font-semibold text-slate-900 text-sm">{title}</h1>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
      <NotificationBell initialCount={unreadCount} />
    </header>
  )
}
