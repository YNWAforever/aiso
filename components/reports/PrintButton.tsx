'use client'

import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { FileDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/**
 * Print mode for the one-page report. On `beforeprint` (the button below, or
 * the browser's own Print command) it renders the end state of every
 * animation synchronously and drops the dark theme, so the PDF is the light,
 * fully drawn report; `afterprint` restores both. Mount it once per page.
 */
export function usePrintMode(): boolean {
  const [printing, setPrinting] = useState(false)
  useEffect(() => {
    const html = document.documentElement
    let restoreDark = false
    const before = () => {
      restoreDark = html.classList.contains('dark')
      html.classList.remove('dark')
      flushSync(() => setPrinting(true))
    }
    const after = () => {
      if (restoreDark) html.classList.add('dark')
      restoreDark = false
      setPrinting(false)
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])
  return printing
}

/** "Download PDF": the browser's print window, where Save as PDF is one choice. No server rendering. */
export function PrintButton({ className }: { className?: string }) {
  const t = useTranslations('reportPage')
  return (
    <button
      type="button"
      onClick={() => window.print()}
      title={t('download_pdf_hint')}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-e1 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 print:hidden',
        className,
      )}
    >
      <FileDown aria-hidden="true" className="size-4" />
      {t('download_pdf')}
    </button>
  )
}
