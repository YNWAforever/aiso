'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { LocalTrustAction, LocalTrustActionStatus, LocalTrustEffort, LocalTrustImpact } from '@/lib/types'

type Copy = {
  title: string
  empty: string
  impactLabel: string
  effortLabel: string
  statusLabel: string
  doneLabel: string
  skipLabel: string
  updatingLabel: string
  errorMessage: string
  impactLabels: Record<LocalTrustImpact, string>
  effortLabels: Record<LocalTrustEffort, string>
  statusLabels: Record<LocalTrustActionStatus, string>
}

type CopyInput = Partial<Omit<Copy, 'impactLabels' | 'effortLabels' | 'statusLabels'>> & {
  impactLabels?: Partial<Record<LocalTrustImpact, string>>
  effortLabels?: Partial<Record<LocalTrustEffort, string>>
  statusLabels?: Partial<Record<LocalTrustActionStatus, string>>
}

type Props = {
  clientId: string
  actions: LocalTrustAction[]
  copy?: CopyInput
}

const defaultCopy: Copy = {
  title: 'Trust Gap Checklist',
  empty: 'No trust actions ready yet.',
  impactLabel: 'Impact',
  effortLabel: 'Effort',
  statusLabel: 'Status',
  doneLabel: 'Done',
  skipLabel: 'Skip',
  updatingLabel: 'Saving...',
  errorMessage: 'Something went wrong. Please try again.',
  impactLabels: {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  },
  effortLabels: {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  },
  statusLabels: {
    open: 'Open',
    planned: 'Planned',
    done: 'Done',
    skipped: 'Skipped',
  },
}

function mergeCopy(copy?: CopyInput): Copy {
  return {
    ...defaultCopy,
    ...copy,
    impactLabels: { ...defaultCopy.impactLabels, ...copy?.impactLabels },
    effortLabels: { ...defaultCopy.effortLabels, ...copy?.effortLabels },
    statusLabels: { ...defaultCopy.statusLabels, ...copy?.statusLabels },
  }
}

export function TrustGapChecklist({ clientId, actions, copy }: Props) {
  const router = useRouter()
  const labels = mergeCopy(copy)
  const [busyActionId, setBusyActionId] = useState<string | null>(null)
  const [error, setError] = useState<{ actionId: string; message: string } | null>(null)

  async function updateStatus(actionId: string, status: LocalTrustActionStatus) {
    setBusyActionId(actionId)
    setError(null)

    try {
      const response = await fetch(`/api/dashboard/clients/${encodeURIComponent(clientId)}/local-trust/actions/${encodeURIComponent(actionId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })

      if (!response.ok) {
        setError({ actionId, message: labels.errorMessage })
        return
      }

      router.refresh()
    } catch {
      setError({ actionId, message: labels.errorMessage })
    } finally {
      setBusyActionId(null)
    }
  }

  return (
    <section className="rounded-xl border border-dash-border bg-dash-surface p-5">
      <p className="text-xs font-semibold uppercase tracking-widest text-dash-muted">{labels.title}</p>
      {actions.length === 0 ? (
        <p className="mt-3 text-sm leading-relaxed text-dash-muted">{labels.empty}</p>
      ) : (
        <div className="mt-4 grid gap-3">
          {actions.map(action => {
            const isBusy = busyActionId === action.id

            return (
              <article key={action.id} className="rounded-lg border border-dash-border bg-dash-elevated p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h4 className="text-sm font-semibold leading-snug text-dash-text">{action.title}</h4>
                    <dl className="mt-3 flex flex-wrap gap-2 text-[11px] font-medium text-dash-muted">
                      <div className="rounded-full border border-dash-border px-2.5 py-1">
                        <dt className="inline text-dash-text">{labels.impactLabel}: </dt>
                        <dd className="inline">{labels.impactLabels[action.impact]}</dd>
                      </div>
                      <div className="rounded-full border border-dash-border px-2.5 py-1">
                        <dt className="inline text-dash-text">{labels.effortLabel}: </dt>
                        <dd className="inline">{labels.effortLabels[action.effort]}</dd>
                      </div>
                      <div className="rounded-full border border-dash-border px-2.5 py-1">
                        <dt className="inline text-dash-text">{labels.statusLabel}: </dt>
                        <dd className="inline">{labels.statusLabels[action.status]}</dd>
                      </div>
                    </dl>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      className="min-h-11 rounded-lg bg-primary px-3 py-2.5 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => updateStatus(action.id, 'done')}
                      disabled={isBusy || action.status === 'done'}
                      aria-pressed={action.status === 'done'}
                    >
                      {isBusy ? labels.updatingLabel : labels.doneLabel}
                    </button>
                    <button
                      type="button"
                      className="min-h-11 rounded-lg border border-dash-border px-3 py-2.5 text-xs font-semibold text-dash-text transition hover:bg-dash-surface disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => updateStatus(action.id, 'skipped')}
                      disabled={isBusy || action.status === 'skipped'}
                      aria-pressed={action.status === 'skipped'}
                    >
                      {isBusy ? labels.updatingLabel : labels.skipLabel}
                    </button>
                  </div>
                </div>
                {error?.actionId === action.id ? (
                  <p className="mt-3 text-xs font-medium text-dash-danger">{error.message}</p>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
