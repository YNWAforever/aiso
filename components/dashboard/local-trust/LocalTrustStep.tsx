import { useTranslations } from 'next-intl'
import { getPlanFeatures } from '@/lib/tier'
import type { AgentCompetitor, LocalTrustAction, LocalTrustProfile, LocalTrustSnapshot } from '@/lib/types'
import { CompetitorSnapshot } from './CompetitorSnapshot'
import { LocalTrustLockedPreview } from './LocalTrustLockedPreview'
import { LocalTrustScorePanel } from './LocalTrustScorePanel'
import { OwnerSummary } from './OwnerSummary'
import { RoiTimeline } from './RoiTimeline'

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
      <LocalTrustLockedPreview
        lang={lang}
        copy={{
          title: t('local_trust_locked_title'),
          body: t('local_trust_preview_body'),
          upgradeCta: t('local_trust_upgrade_cta'),
          sampleScore: t('local_trust_sample_score'),
          nextAction: t('local_trust_preview_next_action'),
          nextActionBody: t('local_trust_preview_next_action_body'),
          ownerProof: t('local_trust_preview_owner_proof'),
          ownerProofBody: t('local_trust_preview_owner_proof_body'),
        }}
      />
    )
  }

  if (!snapshot) {
    return (
      <div className="rounded-xl border border-dash-border bg-dash-surface p-6">
        <p className="text-sm font-semibold text-dash-text">{t('setup_local_trust')}</p>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-dash-muted">
          {t('local_trust_setup_prompt')}
        </p>
        {profile && (
          <p className="mt-4 text-[11px] leading-relaxed text-dash-muted">
            {t('local_trust_saved_assumptions')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <OwnerSummary
        snapshot={snapshot}
        actions={actions}
        copy={{
          title: t('owner_summary'),
          scoreLead: t('local_trust_owner_score_lead'),
          gapLead: t('local_trust_owner_gap_lead'),
          nextActionLead: t('local_trust_owner_next_action'),
          noAction: t('local_trust_no_open_action'),
        }}
      />
      <LocalTrustScorePanel
        score={snapshot.local_trust_score}
        buckets={snapshot.bucket_scores}
        copy={{
          title: t('local_trust_score'),
          strongest: t('local_trust_bucket_strongest'),
          weakest: t('local_trust_bucket_weakest'),
          topAction: t('local_trust_bucket_top_action'),
        }}
      />
      <RoiTimeline
        snapshots={[snapshot]}
        locale={lang === 'zh-HK' ? 'zh-HK' : 'en-HK'}
        copy={{
          title: t('roi_timeline'),
          empty: t('local_trust_timeline_empty'),
          scoreLabel: t('local_trust_score'),
          estimateLabel: t('local_trust_timeline_estimate'),
          noEstimate: t('local_trust_timeline_no_estimate'),
        }}
      />
      {features.local_trust_competitors ? (
        <CompetitorSnapshot
          competitors={competitors}
          copy={{
            title: t('competitor_snapshot'),
            empty: t('local_trust_competitor_empty'),
            mentionGap: t('local_trust_competitor_mention_gap'),
          }}
        />
      ) : (
        <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">{t('competitor_snapshot')}</p>
          <p className="mt-2 text-xs leading-relaxed text-dash-muted">
            {t('local_trust_competitor_enterprise_locked')}
          </p>
        </section>
      )}
    </div>
  )
}
