'use client'

import { Download, Printer } from 'lucide-react'

type Copy = {
  exportLabel: string
  printLabel: string
}

type Props = {
  clientId: string
  copy?: Partial<Copy>
}

const defaultCopy: Copy = {
  exportLabel: 'Export report',
  printLabel: 'Print report',
}

export function ReportActions({ clientId, copy }: Props) {
  const labels = { ...defaultCopy, ...copy }
  const exportHref = `/api/dashboard/clients/${encodeURIComponent(clientId)}/local-trust/export`
  const controlClass = 'inline-flex min-h-10 items-center gap-2 rounded-lg border border-dash-border bg-dash-elevated px-3 py-2 text-xs font-semibold text-dash-text transition hover:bg-dash-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dash-accent/40'

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <a className={controlClass} href={exportHref}>
        <Download className="size-3.5" aria-hidden="true" />
        <span>{labels.exportLabel}</span>
      </a>
      <button className={controlClass} type="button" onClick={() => window.print()}>
        <Printer className="size-3.5" aria-hidden="true" />
        <span>{labels.printLabel}</span>
      </button>
    </div>
  )
}
