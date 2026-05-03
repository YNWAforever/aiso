import { SovChart } from '@/components/pulse/SovChart'
import { MissedTable } from '@/components/pulse/MissedTable'
import { LockedFeature } from '@/components/dashboard/LockedFeature'
import { AlertsTab } from '@/components/pulse/AlertsTab'
import { getPlanFeatures } from '@/lib/tier'
import type { PulseWeeklySummary, PulseMetric } from '@/lib/types'

type Props = {
  plan: string
  clientId: string
  summary: PulseWeeklySummary[]
  missed: PulseMetric[]
}

export function MonitorStep({ plan, clientId, summary, missed }: Props) {
  const features = getPlanFeatures(plan)

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
        <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase mb-4">SoV Trend</p>
        <SovChart data={summary} />
      </div>

      {missed.length > 0 && (
        <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-dash-danger" />
            <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase">Missed Opportunities</p>
          </div>
          <MissedTable rows={missed.slice(0, 3)} platformLabel="Platform" questionLabel="Query" competitorsLabel="Competitors" />
        </div>
      )}

      {features.alerts ? (
        <div className="rounded-xl border border-dash-border bg-dash-surface p-5">
          <AlertsTab clientId={clientId} />
        </div>
      ) : (
        <LockedFeature feature="Weekly Alerts" requiredPlan="Pro" price="$79/month" />
      )}
    </div>
  )
}
