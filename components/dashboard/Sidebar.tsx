'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createBrowserClient } from '@supabase/ssr'
import { useRouter } from 'next/navigation'
import {
  Home, BarChart2, BookOpen, Settings, Wrench,
  ChevronRight, LogOut, Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProfileWithAccount } from '@/lib/types'
import { resolveCommercialEntitlement } from '@/lib/tier'

interface Props {
  profile: ProfileWithAccount
  lang: string
  clientId?: string
}

const PLAN_STYLES: Record<string, string> = {
  free:       'bg-muted text-muted-foreground',
  basic:      'bg-secondary text-secondary-foreground',
  pro:        'bg-primary/10 text-primary',
  enterprise: 'bg-violet-100 text-violet-700',
}

interface NavItem {
  href:     string
  icon:     React.ComponentType<{ className?: string }>
  label:    string
  proOnly?: boolean
}

export function Sidebar({ profile, lang, clientId }: Props) {
  const pathname = usePathname()
  const router   = useRouter()
  const { plan, features } = resolveCommercialEntitlement(profile.accounts)
  const base     = `/${lang}/dashboard`

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )

  const signOut = async () => {
    await supabase.auth.signOut()
    router.push(`/${lang}/auth/login`)
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/')

  const navItems: NavItem[] = [
    { href: base,                            icon: Home,      label: 'My Brands' },
    ...(clientId ? [
      { href: `${base}/${clientId}`,         icon: BarChart2, label: 'AI Pulse' },
      { href: `${base}/${clientId}/prompts`, icon: BookOpen,  label: 'Prompts', proOnly: true },
    ] : []),
    { href: `${base}/settings`,              icon: Settings,  label: 'Settings' },
    ...(profile.is_admin ? [
      { href: '/admin',                      icon: Wrench,    label: 'Admin' },
    ] : []),
  ]

  return (
    <aside className="w-52 flex-shrink-0 flex flex-col h-screen sticky top-0 border-r bg-sidebar-background text-sidebar-foreground border-sidebar-border">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-sidebar-border flex items-center gap-2">
        <Zap className="size-4 text-primary" />
        <p className="font-black text-sm text-foreground">
          Fimmick <span className="text-primary">AEO</span>
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, icon: Icon, label, proOnly }) => {
          const active = isActive(href)
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-primary/10 text-primary font-semibold'
                  : 'text-sidebar-muted-fg hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <Icon className="size-4 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              {proOnly && !features.edit_prompts && (
                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-semibold">
                  PRO
                </span>
              )}
              {active && <ChevronRight className="size-3 opacity-50" />}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-4 border-t border-sidebar-border space-y-2">
        <span
          className={cn(
            'text-xs font-semibold px-2 py-1 rounded-full inline-block',
            PLAN_STYLES[plan] ?? PLAN_STYLES.basic
          )}
        >
          {plan.toUpperCase()}
        </span>
        <p className="text-xs text-muted-foreground truncate px-1">
          {profile.display_name ?? 'Account'}
        </p>
        <button
          onClick={signOut}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <LogOut className="size-3" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
