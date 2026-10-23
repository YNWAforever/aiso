'use client'

import { useEffect } from 'react'
import { FileDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/**
 * Prints light whatever the theme: on `beforeprint` (the button below, or the
 * browser's own Print command) it drops the `dark` class and `afterprint`
 * restores it. The visuals need nothing here: their CSS reveal states apply
 * on screen only, so print always gets the finished drawing. Mount it once.
 */
export function PrintThemeGuard() {
  useEffect(() => {
    const html = document.documentElement
    let restoreDark = false
    const before = () => {
      restoreDark = html.classList.contains('dark')
      html.classList.remove('dark')
    }
    const after = () => {
      if (restoreDark) html.classList.add('dark')
      restoreDark = false
    }
    window.addEventListener('beforeprint', before)
    window.addEventListener('afterprint', after)
    return () => {
      window.removeEventListener('beforeprint', before)
      window.removeEventListener('afterprint', after)
    }
  }, [])
  return null
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
