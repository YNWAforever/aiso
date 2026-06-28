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

export function LocalTrustStep({ plan, profile, snapshot, actions, competitors }: Props) {
  const features = getPlanFeatures(plan)

  if (!features.local_trust_roi) {
    return (
      <div className="rounded-xl border border-dash-border bg-dash-surface p-6">
        <p className="text-sm font-semibold text-dash-text">Local Trust ROI</p>
        <p className="mt-1 text-xs leading-relaxed text-dash-muted">
          Upgrade to Pro to unlock owner-friendly trust scoring, action priorities, and proof of progress.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-dash-border bg-dash-surface p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-dash-text">Local Trust ROI</p>
          <p className="mt-1 text-xs leading-relaxed text-dash-muted">
            {snapshot
              ? `${actions.length} trust actions ready${competitors.length > 0 ? ` with ${competitors.length} competitor signals` : ''}.`
              : 'Run a scan and add assumptions to generate your first ROI view.'}
          </p>
        </div>
        {snapshot && (
          <div className="shrink-0 rounded-lg border border-dash-border bg-dash-elevated px-3 py-2 text-right">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-dash-muted">Score</p>
            <p className="font-mono text-lg font-bold text-dash-text">{snapshot.local_trust_score}/100</p>
          </div>
        )}
      </div>
      {!snapshot && profile && (
        <p className="mt-4 text-[11px] text-dash-muted">
          Saved assumptions found. Your first Local Trust snapshot will appear after the next eligible scan.
        </p>
      )}
    </div>
  )
}
