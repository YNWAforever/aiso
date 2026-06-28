'use client'

import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LogOut, Wrench, Scan, FileBarChart2, Sparkles, Radio, Brain, Settings, TrendingUp, Lock } from 'lucide-react'
import { getPlanFeatures } from '@/lib/tier'
import { ThemeToggle } from '@/components/dashboard/ThemeToggle'

const STEPS = [
  { key: 'scan',    labelKey: 'nav_scan',    icon: Scan,          descKey: 'nav_scan_desc' },
  { key: 'results', labelKey: 'nav_results', icon: FileBarChart2, descKey: 'nav_results_desc' },
  { key: 'improve', labelKey: 'nav_improve', icon: Sparkles,      descKey: 'nav_improve_desc' },
  { key: 'monitor', labelKey: 'nav_monitor', icon: Radio,         descKey: 'nav_monitor_desc' },
  { key: 'roi',     labelKey: 'nav_roi',     icon: TrendingUp,    descKey: 'nav_roi_desc' },
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
  const t = useTranslations('dashboard')
  const params = useParams<{ lang: string }>()
  const searchParams = useSearchParams()
  const lang = params?.lang ?? 'en'
  const step = searchParams?.get('step') ?? 'scan'
  const plan = profile.accounts?.plan ?? 'basic'
  const features = getPlanFeatures(plan)

  return (
    <aside className="w-60 shrink-0 border-r border-border bg-white flex flex-col min-h-full">

      {/* Logo header */}
      <div className="px-5 py-4 border-b border-border">
        <Link href={`/${lang}/dashboard`} className="flex items-center gap-2.5">
          <div className="size-7 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <Brain className="size-4 text-white" />
          </div>
          <span className="font-black text-foreground text-sm">
            Fimmick <span className="text-primary">AISO</span>
          </span>
        </Link>
        {brandName && (
          <div className="mt-3 px-2 py-1.5 rounded-lg bg-primary/5 border border-primary/10">
            <p className="text-[10px] text-primary/60 font-semibold tracking-widest uppercase mb-0.5">{t('brand_label')}</p>
            <p className="text-xs font-semibold text-foreground truncate">{brandName}</p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="text-[10px] text-muted-foreground/60 font-semibold tracking-widest uppercase mb-2 px-2">{t('workflow')}</p>
        {STEPS.map((s) => {
          const active = step === s.key
          const StepIcon = s.icon
          const locked = (s.key === 'improve' && !features.agent_recs) ||
                          (s.key === 'roi' && !features.local_trust_roi) ||
                          (s.key === 'results' && !brandId)

          return (
            <Link
              key={s.key}
              href={brandId ? `/${lang}/dashboard/${brandId}?step=${s.key}` : `/${lang}/dashboard?step=${s.key}`}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 group ${
                active
                  ? 'bg-primary text-white shadow-sm'
                  : locked
                    ? 'opacity-40 pointer-events-none text-muted-foreground'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <StepIcon className={`size-4 shrink-0 ${active ? 'text-white' : ''}`} />
              <div className="min-w-0 flex-1">
                <p className={`text-xs font-semibold ${active ? 'text-white' : ''}`}>{t(s.labelKey)}</p>
                <p className={`text-[10px] leading-tight mt-0.5 truncate ${active ? 'text-white/70' : 'text-muted-foreground/60'}`}>
                  {t(s.descKey)}
                </p>
              </div>
              {locked && <Lock className="size-3 ml-auto text-muted-foreground/80" aria-label="Locked" />}
            </Link>
          )
        })}

        {/* Pulse / Prompt Bank links */}
        {brandId && (
          <div className="pt-3 mt-3 border-t border-border space-y-0.5">
            <p className="text-[10px] text-muted-foreground/60 font-semibold tracking-widest uppercase mb-2 px-2">{t('tools')}</p>
            <Link
              href={`/${lang}/pulse/${brandId}`}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
            >
              <Radio className="size-4 shrink-0" />
              <span className="text-xs font-semibold">AI Pulse</span>
              {!features.alerts && (
                <span className="ml-auto text-[9px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full font-bold">Pro</span>
              )}
            </Link>
            <Link
              href={`/${lang}/pulse/${brandId}#question-bank`}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground transition-all"
            >
              <Brain className="size-4 shrink-0" />
              <span className="text-xs font-semibold">{t('question_bank')}</span>
              {!features.edit_prompts && (
                <span className="ml-auto text-[9px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full font-bold">Pro</span>
              )}
            </Link>
          </div>
        )}
      </nav>

      {/* Theme toggle */}
      <div className="px-3 pb-2">
        <ThemeToggle />
      </div>

      {/* Plan badge */}
      <div className="px-3 pb-3">
        <div className="rounded-xl bg-gradient-to-br from-primary/5 to-blue-50 p-3 border border-primary/10">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] text-primary/60 font-semibold tracking-widest uppercase">{t('plan_label')}</p>
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${
              plan === 'enterprise' ? 'bg-violet-100 text-violet-700' :
              plan === 'pro' ? 'bg-primary/15 text-primary' :
              'bg-muted text-muted-foreground'
            }`}>
              {plan.charAt(0).toUpperCase() + plan.slice(1)}
            </span>
          </div>
          <Link href={`/${lang}/dashboard/settings`}
            className="text-[10px] text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
            <Settings className="size-2.5" /> {t('manage_plan')}
          </Link>
        </div>
      </div>

      {/* User footer */}
      <div className="px-3 pb-4 pt-2 border-t border-border">
        <div className="flex items-center gap-2 px-2">
          <div className="size-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-[10px] font-bold text-primary">
              {(profile.display_name ?? 'U')[0]?.toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-medium text-foreground truncate">{profile.display_name ?? 'User'}</p>
            <p className="text-[10px] text-muted-foreground">{plan}</p>
          </div>
          {profile.is_admin && (
            <Link href={`/${lang}/admin`} className="text-muted-foreground hover:text-foreground transition-colors" title={t('admin')}>
              <Wrench size={13} />
            </Link>
          )}
          <Link href="/auth/logout" className="text-muted-foreground hover:text-destructive transition-colors" title={t('sign_out')}>
            <LogOut size={13} />
          </Link>
        </div>
      </div>
    </aside>
  )
}
