import Link from 'next/link'
import { LockKeyhole, TrendingUp } from 'lucide-react'

type Copy = {
  title: string
  body: string
  upgradeCta: string
  sampleScore: string
  nextAction: string
  nextActionBody: string
  ownerProof: string
  ownerProofBody: string
}

const defaultCopy: Copy = {
  title: 'Local Trust ROI',
  body: 'Preview how Pro turns local trust, AI visibility, and completed fixes into owner-ready progress.',
  upgradeCta: 'Upgrade to Pro',
  sampleScore: 'Sample score',
  nextAction: 'Next action',
  nextActionBody: 'Add two local proof points near consultation CTAs.',
  ownerProof: 'Owner proof',
  ownerProofBody: 'Show monthly trust gains and completed fixes in one view.',
}

type Props = {
  lang?: string
  copy?: Partial<Copy>
}

export function LocalTrustLockedPreview({ lang = 'en', copy }: Props) {
  const labels = { ...defaultCopy, ...copy }

  return (
    <div className="rounded-xl border border-dash-border bg-dash-surface p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <LockKeyhole className="size-4 shrink-0 text-dash-muted" aria-hidden="true" />
            <p className="text-sm font-semibold text-dash-text">{labels.title}</p>
          </div>
          <p className="mt-2 max-w-xl text-xs leading-relaxed text-dash-muted">
            {labels.body}
          </p>
        </div>
        <Link
          href={`/${lang}/pricing`}
          className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary/90"
        >
          {labels.upgradeCta}
        </Link>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-dash-border bg-dash-elevated p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-dash-muted">{labels.sampleScore}</p>
          <div className="mt-2 flex items-center gap-2">
            <span className="font-mono text-lg font-bold text-dash-text">62</span>
            <TrendingUp className="size-4 text-dash-success" aria-hidden="true" />
            <span className="font-mono text-lg font-bold text-dash-text">71</span>
          </div>
        </div>
        <div className="rounded-lg border border-dash-border bg-dash-elevated p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-dash-muted">{labels.nextAction}</p>
          <p className="mt-2 text-xs leading-snug text-dash-text">{labels.nextActionBody}</p>
        </div>
        <div className="rounded-lg border border-dash-border bg-dash-elevated p-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-dash-muted">{labels.ownerProof}</p>
          <p className="mt-2 text-xs leading-snug text-dash-text">{labels.ownerProofBody}</p>
        </div>
      </div>
    </div>
  )
}
