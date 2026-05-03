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
  } catch { /* non-critical */ }

  return (
    <header className="border-b border-[#1e1e30] bg-[#0a0a14] px-6 py-3 flex items-center justify-between shrink-0">
      <div>
        <p className="font-semibold text-[#e0e0ec] text-sm">{title}</p>
        {subtitle && <p className="text-[11px] text-[#5c5c6e] mt-0.5 font-mono">{subtitle}</p>}
      </div>
      <NotificationBell initialCount={unreadCount} />
    </header>
  )
}
