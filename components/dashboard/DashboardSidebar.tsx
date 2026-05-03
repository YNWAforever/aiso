'use client'

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { LogOut, Wrench } from 'lucide-react'
import { getPlanFeatures } from '@/lib/tier'

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
  const hasScan = true // determined server-side, passed through

  return (
    <aside className="w-56 shrink-0 border-r border-[#1e1e30] bg-[#0a0a14] flex flex-col min-h-full">
      {/* Brand context */}
      {brandName && (
        <div className="px-4 pt-4 pb-3 border-b border-[#1e1e30]">
          <p className="text-[10px] text-[#5c5c6e] tracking-widest uppercase mb-1">Brand</p>
          <p className="text-sm font-semibold text-[#e0e0ec] truncate">{brandName}</p>
        </div>
      )}

      {/* Navigation steps */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="text-[10px] text-[#5c5c6e] tracking-widest uppercase mb-2 px-2">Navigation</p>
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
                  ? 'bg-[#00d4ff10] border border-[#00d4ff30]'
                  : locked
                    ? 'opacity-40 pointer-events-none'
                    : 'hover:bg-[#141422] border border-transparent'
              }`}
            >
              <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold font-mono shrink-0 mt-px ${
                active ? 'bg-[#00d4ff] text-[#050510]' : 'bg-[#1e1e30] text-[#5c5c6e]'
              }`}>
                {locked ? '🔒' : s.num}
              </span>
              <div className="min-w-0">
                <p className={`text-xs font-medium ${active ? 'text-[#e0e0ec]' : 'text-[#8c8c9e]'}`}>
                  {s.label}
                </p>
                <p className="text-[10px] text-[#3c3c4e] leading-relaxed mt-0.5 line-clamp-2">
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
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[#8c8c9e] hover:bg-[#141422] hover:text-[#a78bfa] transition-colors"
          >
            <span className="w-5 h-5 rounded bg-[#1e1e30] flex items-center justify-center text-[10px] font-mono">P</span>
            Prompt Bank
            {!features.edit_prompts && (
              <span className="ml-auto text-[9px] text-[#f59e0b] bg-[#f59e0b15] px-1.5 py-0.5 rounded uppercase font-bold">Pro</span>
            )}
          </Link>
        </div>
      )}

      {/* Plan badge */}
      <div className="px-3 pb-3">
        <div className="rounded-lg bg-[#141422] p-3 border border-[#1e1e30]">
          <p className="text-[10px] text-[#5c5c6e] tracking-widest uppercase mb-1">Current Plan</p>
          <p className={`text-xs font-bold font-mono ${
            plan === 'enterprise' ? 'text-[#a78bfa]' : plan === 'pro' ? 'text-[#00d4ff]' : 'text-[#8c8c9e]'
          }`}>{plan.charAt(0).toUpperCase() + plan.slice(1)}</p>
          <Link
            href={`/${lang}/dashboard/settings`}
            className="block text-[10px] text-[#5c5c6e] hover:text-[#8c8c9e] mt-1.5 transition-colors"
          >
            Manage plan →
          </Link>
        </div>
      </div>

      {/* User footer */}
      <div className="px-3 pb-4 pt-2 border-t border-[#1e1e30]">
        <div className="flex items-center gap-2 px-2">
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-[#8c8c9e] truncate">{profile.display_name ?? 'User'}</p>
            <p className="text-[10px] text-[#5c5c6e] font-mono">{plan}</p>
          </div>
          {profile.is_admin && (
            <Link href={`/${lang}/admin`} className="text-[#5c5c6e] hover:text-[#8c8c9e] transition-colors" title="Admin">
              <Wrench size={14} />
            </Link>
          )}
          <Link href="/auth/logout" className="text-[#5c5c6e] hover:text-[#ef4444] transition-colors" title="Sign out">
            <LogOut size={14} />
          </Link>
        </div>
      </div>
    </aside>
  )
}
