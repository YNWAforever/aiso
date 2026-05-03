import { AgentSection } from '@/components/dashboard/AgentSection'
import { AgentRecommendations } from '@/components/dashboard/AgentRecommendations'
import { AgentProgress } from '@/components/dashboard/AgentProgress'
import { AgentCompetitors } from '@/components/dashboard/AgentCompetitors'
import { LockedFeature } from '@/components/dashboard/LockedFeature'
import { getPlanFeatures } from '@/lib/tier'
import type { Scan, AgentRecommendation, AgentProgress as AgentProgressType, AgentCompetitor } from '@/lib/types'

type Props = {
  scan: Scan
  plan: string
  recommendations: AgentRecommendation[]
  progress: AgentProgressType[]
  competitors: AgentCompetitor[]
}

export function ImproveStep({ scan, plan, recommendations, progress, competitors }: Props) {
  const features = getPlanFeatures(plan)
  const allowedRecs = recommendations.filter(r => features.platform_access.includes(r.platform))

  return (
    <AgentSection status={scan.agent_status}>
      <div className="space-y-3">
        {features.agent_recs ? (
          <AgentRecommendations recommendations={allowedRecs} />
        ) : (
          <LockedFeature feature="Agent Recommendations" requiredPlan="Pro" price="$79/month" />
        )}

        {features.agent_progress ? (
          <AgentProgress progress={progress} />
        ) : (
          <LockedFeature feature="Progress Tracking" requiredPlan="Pro" price="$79/month">
            <AgentProgress progress={progress} />
          </LockedFeature>
        )}

        {features.agent_competitors ? (
          <AgentCompetitors competitors={competitors} />
        ) : (
          <LockedFeature feature="Competitor Intelligence" requiredPlan="Enterprise" price="$199/month">
            <AgentCompetitors competitors={competitors.slice(0, 1)} />
          </LockedFeature>
        )}
      </div>
    </AgentSection>
  )
}
