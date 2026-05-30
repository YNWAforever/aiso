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
    <div className="flex items-center justify-center gap-0 py-3 px-6 border-b border-border bg-muted/30">
      {STEPS.map((step, i) => {
        const access = stepAccess[step.key]!
        const isCurrent = step.key === current
        const isCompleted = i < currentIdx
        const isLocked = !access.accessible && i > currentIdx

        return (
          <div key={step.key} className="flex items-center">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
              isCurrent ? 'bg-primary/10' : ''
            }`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold font-mono transition-colors ${
                isCompleted
                  ? 'bg-success text-success-foreground'
                  : isCurrent
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
              }`}>
                {isCompleted ? '✓' : isLocked ? '🔒' : i + 1}
              </div>
              <span className={`text-xs- font-medium transition-colors ${
                isCurrent ? 'text-foreground' : isCompleted ? 'text-success' : 'text-muted-foreground'
              }`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`w-8 h-px mx-1 ${i < currentIdx ? 'bg-success' : 'bg-border'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
