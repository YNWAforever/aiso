'use client'
import { Bookmark, FileDown } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { ShareButton } from './ShareButton'

interface Props {
  domain: string
  score: number
  grade: string
  /** Anonymous viewers save by creating a free account; owners already have it saved. */
  onSave?: () => void
}

/**
 * Share, PDF and Save. PDF is the browser's own "Save as PDF" over a print
 * stylesheet (app/globals.css, "Print"), so it needs no PDF library and always
 * matches the page. Outline buttons: the page's one filled action is the
 * free-account card.
 */
/** Print in the light theme: a dark PDF wastes toner and reads poorly on paper. */
function printLight() {
  const root = document.documentElement
  const dark = root.classList.contains('dark')
  if (dark) root.classList.remove('dark')
  try { window.print() } finally { if (dark) root.classList.add('dark') }
}

export function ResultActions({ domain, score, grade, onSave }: Props) {
  const t = useTranslations('resultPage')
  const button = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-semibold text-foreground hover:bg-neutral-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
  return (
    <div role="group" aria-label={t('nav_label')} className="flex items-center gap-1.5 sm:gap-2" data-print-hide>
      <ShareButton domain={domain} score={score} grade={grade} />
      <button type="button" onClick={printLight} className={button}>
        <FileDown aria-hidden="true" className="size-3.5" /><span className="sr-only sm:not-sr-only">{t('pdf')}</span>
      </button>
      {onSave && (
        <button type="button" onClick={onSave} className={button} data-testid="save-result">
          <Bookmark aria-hidden="true" className="size-3.5" /><span className="sr-only sm:not-sr-only">{t('save')}</span>
        </button>
      )}
    </div>
  )
}
