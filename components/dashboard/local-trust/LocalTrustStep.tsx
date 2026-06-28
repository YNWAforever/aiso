import Link from 'next/link'
import { LockKeyhole, TrendingUp } from 'lucide-react'
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
  const features = getPlanFeatures(plan)

  if (!features.local_trust_roi) {
    return (
      <div className="rounded-xl border border-dash-border bg-dash-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <LockKeyhole className="size-4 text-dash-muted" aria-hidden="true" />
              <p className="text-sm font-semibold text-dash-text">Local Trust ROI</p>
            </div>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-dash-muted">
              Preview how Pro turns local trust, AI visibility, and completed fixes into owner-ready progress.
            </p>
          </div>
          <Link
            href={`/${lang}/pricing`}
            className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary/90"
          >
            Upgrade to Pro
          </Link>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-dash-border bg-dash-elevated p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-dash-muted">Sample score</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-lg font-bold text-dash-text">62</span>
              <TrendingUp className="size-4 text-dash-success" aria-hidden="true" />
              <span className="font-mono text-lg font-bold text-dash-text">71</span>
            </div>
          </div>
          <div className="rounded-lg border border-dash-border bg-dash-elevated p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-dash-muted">Next action</p>
            <p className="mt-2 text-xs leading-snug text-dash-text">Add two local proof points near consultation CTAs.</p>
          </div>
          <div className="rounded-lg border border-dash-border bg-dash-elevated p-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-dash-muted">Owner proof</p>
            <p className="mt-2 text-xs leading-snug text-dash-text">Show monthly trust gains and completed fixes in one view.</p>
          </div>
        </div>
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
