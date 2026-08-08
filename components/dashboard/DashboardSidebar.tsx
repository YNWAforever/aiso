'use client'

import Link from 'next/link'
import { useParams, usePathname, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { LogOut, Wrench, Scan, FileBarChart2, Sparkles, Brain, Settings, Lock, ListChecks } from 'lucide-react'
import type { CommercialEntitlement } from '@/lib/tier'
import { ThemeToggle } from '@/components/dashboard/ThemeToggle'

const STEPS = [
  { key: 'scan',    labelKey: 'nav_scan',    icon: Scan,          descKey: 'nav_scan_desc' },
  { key: 'results', labelKey: 'nav_results', icon: FileBarChart2, descKey: 'nav_results_desc' },
  { key: 'improve', labelKey: 'nav_improve', icon: Sparkles,      descKey: 'nav_improve_desc' },
] as const

type Props = {
  profile: {
    display_name?: string | null
    is_admin?: boolean
  }
  entitlement: CommercialEntitlement
  /**
   * Optional fallback only. The layout above cannot see the [clientId] segment,
   * so nothing supplies this today — the id comes from useParams below.
   */
  brandId?: string
}

export function DashboardSidebar({ profile, entitlement, brandId }: Props) {
  const t = useTranslations('dashboard')
  const params = useParams<{ lang: string; clientId?: string }>()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const lang = params?.lang ?? 'en'
  // Read the brand from the route rather than trusting the prop. The layout
  // derives it from an `x-invoke-path` header that Next 13 set and Next 16 does
  // not — nothing in the app or the framework sets it — so `brandId` has been
  // permanently undefined. Every link therefore dropped the brand and pointed at
  // the brand-less dashboard, and `results` was locked and unclickable forever.
  // A layout cannot see a child segment's params, but this is a client component
  // rendered inside the route, so useParams can.
  const clientId = params?.clientId ?? brandId
  const step = searchParams?.get('step') ?? 'scan'
  const { plan, features } = entitlement

  // Sub-routes carry no ?step=, so without this the Scan entry would render as
  // active while the user is on the question bank.
  const onSubRoute = Boolean(pathname && /\/dashboard\/[^/]+\/[^/]+/.test(pathname))

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
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        <p className="text-[10px] text-muted-foreground/60 font-semibold tracking-widest uppercase mb-2 px-2">{t('workflow')}</p>
        {STEPS.map((s) => {
          const active = !onSubRoute && step === s.key
          const StepIcon = s.icon
          const locked = (s.key === 'improve' && !features.agent_recs) ||
                          (s.key === 'results' && !clientId)
          const blocksNavigation = locked

          return (
            <Link
              key={s.key}
              href={clientId ? `/${lang}/dashboard/${clientId}?step=${s.key}` : `/${lang}/dashboard?step=${s.key}`}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 group ${
                active
                  ? 'bg-primary text-white shadow-sm'
                  : blocksNavigation
                    ? 'opacity-40 pointer-events-none text-muted-foreground'
                    : locked
                      ? 'opacity-55 text-muted-foreground hover:bg-secondary hover:text-foreground'
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

        {/* Tools — real sub-routes rather than ?step= values. This block and its
            two translation keys existed before 7b0cb9d removed them, which it did
            because the question bank's target was fenced, not because the shape
            was wrong. The target now exists.

            Deliberately NOT pointer-events-none when unentitled: the page renders
            its own locked card and a link to pricing, so blocking navigation
            would make that unreachable. Same carve-out the roi entry had. */}
        {clientId && (
          <>
            <p className="text-[10px] text-muted-foreground/60 font-semibold tracking-widest uppercase mb-2 mt-5 px-2">
              {t('tools')}
            </p>
            <Link
              href={`/${lang}/dashboard/${clientId}/prompts`}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 ${
                pathname?.endsWith('/prompts')
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <ListChecks className={`size-4 shrink-0 ${pathname?.endsWith('/prompts') ? 'text-white' : ''}`} />
              <span className="text-xs font-semibold">{t('question_bank')}</span>
              {!features.edit_prompts && (
                <span className="ml-auto text-[9px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full font-bold">
                  Pro
                </span>
              )}
            </Link>
          </>
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
          <Link href={`/${lang}/auth/logout`} className="text-muted-foreground hover:text-destructive transition-colors" title={t('sign_out')}>
            <LogOut size={13} />
          </Link>
        </div>
      </div>
    </aside>
  )
}
