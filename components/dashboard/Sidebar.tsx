'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import type { ProfileWithAccount } from '@/lib/types'

interface Props {
  profile: ProfileWithAccount
  lang: string
  clientId?: string
}

const PLAN_COLORS: Record<string, string> = {
  starter: 'bg-slate-600 text-slate-200',
  pro: 'bg-blue-900 text-blue-300',
  enterprise: 'bg-violet-900 text-violet-300',
}

export function Sidebar({ profile, lang, clientId }: Props) {
  const pathname = usePathname()
  const router   = useRouter()
  const plan     = profile.accounts?.plan ?? 'starter'
  const base     = `/${lang}/dashboard`

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  const navItem = (href: string, icon: string, label: string, proOnly?: boolean) => (
    <Link
      key={href}
      href={href}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition ${
        isActive(href)
          ? 'bg-slate-700 text-white'
          : 'text-slate-400 hover:text-white hover:bg-slate-800'
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
      {proOnly && plan === 'starter' && (
        <span className="ml-auto text-xs bg-blue-900 text-blue-300 px-1.5 py-0.5 rounded">PRO</span>
      )}
    </Link>
  )

  return (
    <aside className="w-52 flex-shrink-0 bg-slate-900 flex flex-col h-screen sticky top-0">
      <div className="px-4 py-4 border-b border-slate-800">
        <p className="font-black text-white text-sm">
          Fimmick <span className="text-blue-400">AEO</span>
        </p>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
        {navItem(base, '🏠', 'My Brands')}
        {clientId && navItem(`${base}/${clientId}`, '📊', 'AI Pulse')}
        {clientId && navItem(`${base}/${clientId}/prompts`, '📋', 'Prompts', true)}
        {navItem(`${base}/settings`, '⚙️', 'Settings')}
        {profile.is_admin && navItem('/admin', '🔧', 'Admin')}
      </nav>

      <div className="px-3 py-4 border-t border-slate-800 space-y-2">
        <div className={`text-xs font-semibold px-2 py-1 rounded inline-block ${PLAN_COLORS[plan] ?? PLAN_COLORS.starter}`}>
          {plan.toUpperCase()}
        </div>
        <p className="text-xs text-slate-500 truncate">{profile.display_name ?? 'Account'}</p>
        <button
          onClick={signOut}
          className="text-xs text-slate-500 hover:text-slate-300 transition"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}
