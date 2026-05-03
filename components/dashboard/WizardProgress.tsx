import { getPlanFeatures } from '@/lib/tier'

type Step = { key: string; label: string }

const STEPS: Step[] = [
  { key: 'scan',    label: 'Scan' },
  { key: 'results', label: 'Results' },
  { key: 'improve', label: 'Improve' },
  { key: 'monitor', label: 'Monitor' },
]

type Props = {
  current: string
  plan: string
  hasScan: boolean
}

export function WizardProgress({ current, plan, hasScan }: Props) {
  const features = getPlanFeatures(plan)
  const currentIdx = STEPS.findIndex(s => s.key === current)

  const stepAccess: Record<string, { accessible: boolean; reason?: string }> = {
    scan:    { accessible: true },
    results: { accessible: hasScan },
    improve:  { accessible: hasScan && features.agent_recs, reason: !features.agent_recs ? 'Pro plan required for agent analysis' : undefined },
    monitor:  { accessible: hasScan },
  }

  return (
    <div className="flex items-center justify-center gap-0 py-3 px-6 border-b border-[#1e1e30] bg-[#0d0d18]">
      {STEPS.map((step, i) => {
        const access = stepAccess[step.key]!
        const isCurrent = step.key === current
        const isCompleted = i < currentIdx
        const isLocked = !access.accessible && i > currentIdx

        return (
          <div key={step.key} className="flex items-center">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
              isCurrent ? 'bg-[#00d4ff12]' : ''
            }`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-mono transition-colors ${
                isCompleted
                  ? 'bg-[#22c55e] text-white'
                  : isCurrent
                    ? 'bg-[#00d4ff] text-[#050510]'
                    : isLocked
                      ? 'bg-[#1e1e30] text-[#5c5c6e]'
                      : 'bg-[#1e1e30] text-[#5c5c6e]'
              }`}>
                {isCompleted ? '✓' : isLocked ? '🔒' : i + 1}
              </div>
              <span className={`text-[11px] font-medium transition-colors ${
                isCurrent ? 'text-[#e0e0ec]' : isCompleted ? 'text-[#22c55e]' : 'text-[#5c5c6e]'
              }`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px mx-1 ${i < currentIdx ? 'bg-[#22c55e]' : 'bg-[#1e1e30]'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
