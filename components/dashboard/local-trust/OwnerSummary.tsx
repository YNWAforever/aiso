import type { LocalTrustAction, LocalTrustSnapshot } from '@/lib/types'

type Copy = {
  title: string
  scoreLead: string
  gapLead: string
  nextActionLead: string
  noAction: string
}

const defaultCopy: Copy = {
  title: 'Owner Summary',
  scoreLead: 'Your local trust score is',
  gapLead: 'The biggest gap is',
  nextActionLead: 'Next best action:',
  noAction: 'No open trust action is ready yet.',
}

type Props = {
  snapshot: LocalTrustSnapshot
  actions: LocalTrustAction[]
  copy?: Partial<Copy>
}

export function OwnerSummary({ snapshot, actions, copy }: Props) {
  const labels = { ...defaultCopy, ...copy }
  const topAction = actions.find(action => action.status === 'open') ?? actions[0]
  const weakestBucket = [...snapshot.bucket_scores].sort((a, b) => {
    const aRatio = a.maxScore ? a.score / a.maxScore : a.score
    const bRatio = b.maxScore ? b.score / b.maxScore : b.score
    return aRatio - bRatio
  })[0]

  return (
    <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">{labels.title}</p>
      <p className="mt-3 text-sm leading-relaxed text-dash-text">
        {labels.scoreLead} <strong>{snapshot.local_trust_score}/100</strong>.
        {weakestBucket
          ? ` ${labels.gapLead} ${weakestBucket.label.toLowerCase()}: ${weakestBucket.topAction}.`
          : ''}
        {topAction
          ? ` ${labels.nextActionLead} ${topAction.title}.`
          : ` ${labels.noAction}`}
      </p>
    </section>
  )
}
