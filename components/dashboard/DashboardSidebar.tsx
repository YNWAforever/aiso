'use client'

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { LogOut, Wrench } from 'lucide-react'
import { getPlanFeatures } from '@/lib/tier'
import { ThemeToggle } from '@/components/dashboard/ThemeToggle'

const STEPS = [
  { key: 'scan',    label: 'Scan',    num: 1, desc: 'Run an AISO readiness check on any URL' },
  { key: 'results', label: 'Results', num: 2, desc: 'Review your 20-check diagnostic report' },
  { key: 'improve', label: 'Improve', num: 3, desc: 'Get AI agent analysis and fix recommendations' },
  { key: 'monitor', label: 'Monitor', num: 4, desc: 'Track your share of voice across AI platforms' },
] as const

type Props = {
  profile: {
    display_name?: string | null
    is_admin?: boolean
    accounts?: { plan?: string } | null
  }
  brandName?: string
  brandId?: string
}

export function DashboardSidebar({ profile, brandName, brandId }: Props) {
  const params = useParams<{ lang: string }>()
  const searchParams = useSearchParams()
  const lang = params?.lang ?? 'en'
  const step = searchParams?.get('step') ?? 'scan'
  const plan = profile.accounts?.plan ?? 'basic'
  const features = getPlanFeatures(plan)

  return (
    <aside className="w-56 shrink-0 border-r border-dash-border bg-sidebar-background flex flex-col min-h-full">
      {/* Brand context */}
      {brandName && (
        <div className="px-4 pt-4 pb-3 border-b border-dash-border">
          <p className="text-[10px] text-dash-muted tracking-widest uppercase mb-1">Brand</p>
          <p className="text-sm font-semibold text-dash-text truncate">{brandName}</p>
        </div>
      )}

      {/* Navigation steps */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="text-[10px] text-dash-muted tracking-widest uppercase mb-2 px-2">Navigation</p>
        {STEPS.map((s) => {
          const active = step === s.key
          const locked = (s.key === 'improve' && !features.agent_recs) ||
                          (s.key === 'results' && !brandId)

          return (
            <Link
              key={s.key}
              href={brandId ? `/${lang}/dashboard/${brandId}?step=${s.key}` : `/${lang}/dashboard?step=${s.key}`}
              className={`flex items-start gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group ${
                active
                  ? 'bg-dash-accent/10 border border-dash-accent/20'
                  : locked
                    ? 'opacity-40 pointer-events-none'
                    : 'hover:bg-dash-elevated border border-transparent'
              }`}
            >
              <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold font-mono shrink-0 mt-px ${
                active ? 'bg-dash-accent text-dash-bg' : 'bg-dash-elevated text-dash-muted'
              }`}>
                {locked ? '🔒' : s.num}
              </span>
              <div className="min-w-0">
                <p className={`text-xs font-medium ${active ? 'text-dash-text' : 'text-dash-muted'}`}>
                  {s.label}
                </p>
                <p className="text-[10px] text-dash-muted/60 leading-relaxed mt-0.5 line-clamp-2">
                  {s.desc}
                </p>
              </div>
            </Link>
          )
        })}
      </nav>

      {/* Prompts link */}
      {brandId && (
        <div className="px-3 pb-2">
          <Link
            href={`/${lang}/dashboard/${brandId}/prompts`}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-dash-muted hover:bg-dash-elevated hover:text-dash-purple transition-colors"
          >
            <span className="w-5 h-5 rounded bg-dash-elevated flex items-center justify-center text-[10px] font-mono">P</span>
            Prompt Bank
            {!features.edit_prompts && (
              <span className="ml-auto text-[9px] text-warning bg-warning/10 px-1.5 py-0.5 rounded uppercase font-bold">Pro</span>
            )}
          </Link>
        </div>
      )}

      {/* Theme toggle */}
      <div className="px-3 pb-2">
        <ThemeToggle />
      </div>

      {/* Plan badge */}
      <div className="px-3 pb-3">
        <div className="rounded-lg bg-dash-elevated p-3 border border-dash-border">
          <p className="text-[10px] text-dash-muted tracking-widest uppercase mb-1">Current Plan</p>
          <p className={`text-xs font-bold font-mono ${
            plan === 'enterprise' ? 'text-dash-purple' : plan === 'pro' ? 'text-dash-accent' : 'text-dash-muted'
          }`}>{plan.charAt(0).toUpperCase() + plan.slice(1)}</p>
          <Link
            href={`/${lang}/dashboard/settings`}
            className="block text-[10px] text-dash-muted hover:text-dash-text mt-1.5 transition-colors"
          >
            Manage plan →
          </Link>
        </div>
      </div>

      {/* User footer */}
      <div className="px-3 pb-4 pt-2 border-t border-dash-border">
        <div className="flex items-center gap-2 px-2">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-dash-muted truncate">{profile.display_name ?? 'User'}</p>
            <p className="text-[10px] text-dash-muted/60 font-mono">{plan}</p>
          </div>
          {profile.is_admin && (
            <Link href={`/${lang}/admin`} className="text-dash-muted hover:text-dash-text transition-colors" title="Admin">
              <Wrench size={14} />
            </Link>
          )}
          <Link href="/auth/logout" className="text-dash-muted hover:text-dash-danger transition-colors" title="Sign out">
            <LogOut size={14} />
          </Link>
        </div>
      </div>
    </aside>
  )
}
