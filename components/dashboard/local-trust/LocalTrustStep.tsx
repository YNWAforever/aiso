import { useTranslations } from 'next-intl'
import { getPlanFeatures } from '@/lib/tier'
import type {
  AgentCompetitor,
  LocalTrustAction,
  LocalTrustBucketKey,
  LocalTrustBucketScore,
  LocalTrustProfile,
  LocalTrustSnapshot,
} from '@/lib/types'
import { CompetitorSnapshot } from './CompetitorSnapshot'
import { LocalTrustLockedPreview } from './LocalTrustLockedPreview'
import { LocalTrustSetupForm } from './LocalTrustSetupForm'
import { LocalTrustScorePanel } from './LocalTrustScorePanel'
import { OwnerSummary } from './OwnerSummary'
import { RoiTimeline } from './RoiTimeline'
import { TrustGapChecklist } from './TrustGapChecklist'

type Props = {
  lang: string
  clientId: string
  plan: string
  profile: LocalTrustProfile | null
  snapshot: LocalTrustSnapshot | null
  actions: LocalTrustAction[]
  competitors: AgentCompetitor[]
}

type BucketDisplayCopy = Pick<LocalTrustBucketScore, 'label' | 'explanation' | 'strongestSignal' | 'weakestSignal' | 'topAction'>

export function LocalTrustStep({ lang, clientId, plan, profile, snapshot, actions, competitors }: Props) {
  const t = useTranslations('dashboard')
  const features = getPlanFeatures(plan)
  const bucketCopy: Record<LocalTrustBucketKey, BucketDisplayCopy> = {
    local_visibility: {
      label: t('local_trust_bucket_local_visibility'),
      explanation: t('local_trust_bucket_local_visibility_explanation'),
      strongestSignal: t('local_trust_bucket_local_visibility_strongest'),
      weakestSignal: t('local_trust_bucket_local_visibility_weakest'),
      topAction: t('local_trust_bucket_local_visibility_top_action'),
    },
    proof_depth: {
      label: t('local_trust_bucket_proof_depth'),
      explanation: t('local_trust_bucket_proof_depth_explanation'),
      strongestSignal: t('local_trust_bucket_proof_depth_strongest'),
      weakestSignal: t('local_trust_bucket_proof_depth_weakest'),
      topAction: t('local_trust_bucket_proof_depth_top_action'),
    },
    ai_answer_readiness: {
      label: t('local_trust_bucket_ai_answer_readiness'),
      explanation: t('local_trust_bucket_ai_answer_readiness_explanation'),
      strongestSignal: t('local_trust_bucket_ai_answer_readiness_strongest'),
      weakestSignal: t('local_trust_bucket_ai_answer_readiness_weakest'),
      topAction: t('local_trust_bucket_ai_answer_readiness_top_action'),
    },
    market_authority: {
      label: t('local_trust_bucket_market_authority'),
      explanation: t('local_trust_bucket_market_authority_explanation'),
      strongestSignal: t('local_trust_bucket_market_authority_strongest'),
      weakestSignal: t('local_trust_bucket_market_authority_weakest'),
      topAction: t('local_trust_bucket_market_authority_top_action'),
    },
  }

  const localizedActionTitle = (action: LocalTrustAction) => {
    switch (action.stable_key) {
      case 'run-first-scan':
        return t('local_trust_action_run_first_scan')
      case 'add-service-area':
        return t('local_trust_action_add_service_area')
      case 'add-primary-services':
        return t('local_trust_action_add_primary_services')
      case 'add-local-faq':
        return t('local_trust_action_add_local_faq')
      case 'strengthen-entity-proof':
        return t('local_trust_action_strengthen_entity_proof')
      case 'close-missed-local-query':
        return t('local_trust_action_close_missed_local_query')
      case 'improve-local_visibility':
        return t('local_trust_bucket_local_visibility_top_action')
      case 'improve-proof_depth':
        return t('local_trust_bucket_proof_depth_top_action')
      case 'improve-ai_answer_readiness':
        return t('local_trust_bucket_ai_answer_readiness_top_action')
      case 'improve-market_authority':
        return t('local_trust_bucket_market_authority_top_action')
      default:
        return bucketCopy[action.bucket]?.topAction ?? t('local_trust_no_open_action')
    }
  }

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
    const setupItems = [
      { label: t('local_trust_setup_first_scan'), found: false },
      { label: t('primary_services'), found: Boolean(profile?.primary_services.length) },
      { label: t('service_area'), found: Boolean(profile?.service_area) },
      { label: t('local_trust_setup_lead_assumptions'), found: profile?.average_lead_value != null && profile.close_rate != null },
      { label: t('competitors'), found: Boolean(profile?.competitors.length || competitors.length) },
      { label: t('local_trust_setup_pulse'), found: false },
    ]

    return (
      <div className="rounded-xl border border-dash-border bg-dash-surface p-6">
        <p className="text-sm font-semibold text-dash-text">{t('setup_local_trust')}</p>
        <p className="mt-2 max-w-xl text-xs leading-relaxed text-dash-muted">
          {t('local_trust_setup_prompt')}
        </p>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {setupItems.map(item => (
            <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border border-dash-border bg-dash-elevated p-3">
              <p className="text-xs font-medium text-dash-text">{item.label}</p>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-widest ${
                item.found ? 'bg-dash-success/10 text-dash-success' : 'bg-dash-warning/10 text-dash-warning'
              }`}
              >
                {item.found ? t('local_trust_setup_found') : t('local_trust_setup_missing')}
              </span>
            </div>
          ))}
        </div>
        {profile && (
          <p className="mt-4 text-[11px] leading-relaxed text-dash-muted">
            {t('local_trust_saved_assumptions')}
          </p>
        )}
      </div>
    )
  }

  const localizedBuckets = snapshot.bucket_scores.map(bucket => ({
    ...bucket,
    ...bucketCopy[bucket.key],
  }))
  const localizedActions = actions.map(action => ({
    ...action,
    title: localizedActionTitle(action),
  }))
  const topAction = localizedActions.find(action => action.status === 'open')
  const weakestBucket = [...localizedBuckets].sort((a, b) => {
    const aRatio = a.maxScore ? a.score / a.maxScore : a.score
    const bRatio = b.maxScore ? b.score / b.maxScore : b.score
    return aRatio - bRatio
  })[0]
  const ownerSummary = weakestBucket
    ? topAction
      ? t('local_trust_owner_summary_with_next_action', {
          score: snapshot.local_trust_score,
          bucket: weakestBucket.label,
          bucketAction: weakestBucket.topAction,
          nextAction: topAction.title,
        })
      : t('local_trust_owner_summary_no_open_action', {
          score: snapshot.local_trust_score,
          bucket: weakestBucket.label,
          bucketAction: weakestBucket.topAction,
        })
    : t('local_trust_owner_summary_no_bucket', {
        score: snapshot.local_trust_score,
      })

  return (
    <div className="space-y-5">
      <LocalTrustSetupForm
        clientId={clientId}
        profile={profile}
        copy={{
          title: t('setup_local_trust'),
          description: t('setup_local_trust_body'),
          primaryServicesLabel: t('primary_services'),
          serviceAreaLabel: t('service_area'),
          averageLeadValueLabel: t('average_lead_value'),
          closeRateLabel: t('close_rate'),
          competitorsLabel: t('competitors'),
          saveLabel: t('save_assumptions'),
          savingLabel: t('alerts_saving'),
          errorMessage: t('generic_error'),
        }}
      />
      <OwnerSummary
        title={t('owner_summary')}
        summary={ownerSummary}
      />
      <LocalTrustScorePanel
        score={snapshot.local_trust_score}
        buckets={localizedBuckets}
        copy={{
          title: t('local_trust_score'),
          strongest: t('local_trust_bucket_strongest'),
          weakest: t('local_trust_bucket_weakest'),
          topAction: t('local_trust_bucket_top_action'),
        }}
      />
      <TrustGapChecklist
        clientId={clientId}
        actions={localizedActions}
        copy={{
          title: t('trust_gap_checklist'),
          empty: t('local_trust_actions_ready', { count: 0 }),
          impactLabel: t('local_trust_action_impact'),
          effortLabel: t('local_trust_action_effort'),
          statusLabel: t('local_trust_action_status'),
          doneLabel: t('mark_done'),
          skipLabel: t('mark_skipped'),
          updatingLabel: t('alerts_saving'),
          errorMessage: t('generic_error'),
          impactLabels: {
            low: t('local_trust_impact_low'),
            medium: t('local_trust_impact_medium'),
            high: t('local_trust_impact_high'),
          },
          effortLabels: {
            low: t('local_trust_effort_low'),
            medium: t('local_trust_effort_medium'),
            high: t('local_trust_effort_high'),
          },
          statusLabels: {
            open: t('local_trust_status_open'),
            planned: t('local_trust_status_planned'),
            done: t('local_trust_status_done'),
            skipped: t('local_trust_status_skipped'),
          },
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
      ) : null}
    </div>
  )
}
