import Link from 'next/link'
import { LockKeyhole, TrendingUp } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { getPlanFeatures } from '@/lib/tier'
import type { AgentCompetitor, LocalTrustAction, LocalTrustProfile, LocalTrustSnapshot } from '@/lib/types'

type Props = {
  lang: string
  clientId: string
  plan: string
  profile: LocalTrustProfile | null
  snapshot: LocalTrustSnapshot | null
  actions: LocalTrustAction[]
  competitors: AgentCompetitor[]
}

export function LocalTrustStep({ lang, plan, profile, snapshot, actions, competitors }: Props) {
  const t = useTranslations('dashboard')
  const features = getPlanFeatures(plan)

  if (!features.local_trust_roi) {
    return (
      <div className="rounded-xl border border-dash-border bg-dash-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <LockKeyhole className="size-4 text-dash-muted" aria-hidden="true" />
              <p className="text-sm font-semibold text-dash-text">{t('local_trust_locked_title')}</p>
            </div>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-dash-muted">
              {t('local_trust_preview_body')}
            </p>
          </div>
          <Link
            href={`/${lang}/pricing`}
            className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary/90"
          >
            {t('local_trust_upgrade_cta')}
          </Link>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-dash-border bg-dash-elevated p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-dash-muted">{t('local_trust_sample_score')}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-lg font-bold text-dash-text">62</span>
              <TrendingUp className="size-4 text-dash-success" aria-hidden="true" />
              <span className="font-mono text-lg font-bold text-dash-text">71</span>
            </div>
          </div>
          <div className="rounded-lg border border-dash-border bg-dash-elevated p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-dash-muted">{t('local_trust_preview_next_action')}</p>
            <p className="mt-2 text-xs leading-snug text-dash-text">{t('local_trust_preview_next_action_body')}</p>
          </div>
          <div className="rounded-lg border border-dash-border bg-dash-elevated p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-dash-muted">{t('local_trust_preview_owner_proof')}</p>
            <p className="mt-2 text-xs leading-snug text-dash-text">{t('local_trust_preview_owner_proof_body')}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-dash-border bg-dash-surface p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-dash-text">{t('local_trust_locked_title')}</p>
          <p className="mt-1 text-xs leading-relaxed text-dash-muted">
            {snapshot
              ? (
                  <>
                    {t('local_trust_actions_ready', { count: actions.length })}
                    {competitors.length > 0 && ` ${t('local_trust_competitor_signals', { count: competitors.length })}`}
                  </>
                )
              : t('local_trust_setup_prompt')}
          </p>
        </div>
        {snapshot && (
          <div className="shrink-0 rounded-lg border border-dash-border bg-dash-elevated px-3 py-2 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-dash-muted">{t('local_trust_score')}</p>
            <p className="font-mono text-lg font-bold text-dash-text">{snapshot.local_trust_score}/100</p>
          </div>
        )}
      </div>
      {!snapshot && profile && (
        <p className="mt-4 text-[11px] text-dash-muted">
          {t('local_trust_saved_assumptions')}
        </p>
      )}
    </div>
  )
}
