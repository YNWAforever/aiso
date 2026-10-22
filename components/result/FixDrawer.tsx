'use client'
import { useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Check, Copy, HelpCircle, Minus, Sparkles, X } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { getCheckExplanations } from '@/lib/checkExplanations'
import { formatScanScore } from '@/lib/score-display'
import { FIX_SNIPPETS } from '@/lib/result/fix-snippets'
import { CHECK_SLOTS, pointsToGain, visualStatus } from '@/lib/result/view-model'
import type { CheckAssessment } from '@/lib/view-models/check-priority'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { TONE_CLASSES, statusTone, type CheckStatus } from '@/components/visuals/tone'
import { CHECK_ICONS } from '@/components/visuals/check-icons'

const STATUS_ICONS = { pass: Check, warn: Minus, fail: X, unknown: HelpCircle } as const

interface Props {
  lang: string
  /** The open check, or null when the drawer is closed. */
  checkKey: string | null
  assessment: CheckAssessment | undefined
  /** The viewer owns the scan, so the Fix Pack is one click away. */
  owner: boolean
  onClose: () => void
  /** The GEO rescale factor (lib/result/view-model geoScale), so GEO points match the score. */
  geoScale: number
  /**
   * Called once the drawer has closed. The drawer opens from many places
   * (fix rows, tiles, list rows), not one trigger, so the page hands focus back.
   */
  onClosed: () => void
  /** Anonymous viewers are sent to the free-account card to generate a fix pack. */
  onSignup: () => void
}

/**
 * One check, explained: what it checks, why it matters, how to fix it, a
 * starter snippet to copy, and what passing would add. Generic guidance only;
 * the scan's own messages and evidence stay in the owner's check list.
 */
export function FixDrawer({ lang, checkKey, assessment, owner, onClose, onClosed, onSignup, geoScale }: Props) {
  const t = useTranslations('resultPage')
  const visuals = useTranslations('visuals')
  const checkNames = useTranslations('checks')
  const locale = useLocale()
  const slot = CHECK_SLOTS.find(s => s.key === checkKey)
  const explanation = checkKey ? getCheckExplanations(locale)[checkKey] : undefined
  const status = visualStatus(assessment)
  const actionable = status === 'warn' || status === 'fail'
  const snippet = checkKey && actionable ? FIX_SNIPPETS[checkKey] : undefined
  const Icon = checkKey ? CHECK_ICONS[checkKey] : undefined
  const tone = TONE_CLASSES[statusTone(status)]

  return (
    <Sheet open={checkKey !== null} onOpenChange={open => { if (!open) onClose() }}>
      <SheetContent
        data-testid="fix-drawer"
        data-check={checkKey ?? undefined}
        onCloseAutoFocus={event => {
          event.preventDefault()
          onClosed()
        }}
      >
        {checkKey && slot && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <span aria-hidden="true" className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl border', tone.soft, tone.fg, tone.border)}>
                  {Icon && <Icon className="size-5" />}
                </span>
                <div className="min-w-0">
                  <SheetTitle className="text-lg font-bold text-foreground">{checkNames(checkKey)}</SheetTitle>
                  <SheetDescription asChild>
                    <span className={cn('mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold', tone.soft, tone.fg)}>{visuals(`status.${status}`)}</span>
                  </SheetDescription>
                </div>
              </div>
            </SheetHeader>

            {status === 'unknown' && <p className="rounded-lg bg-neutral-2 p-3 text-sm text-foreground">{t('drawer.needs_evidence')}</p>}

            {explanation && (
              <dl className="flex flex-col gap-4 text-sm">
                <div>
                  <dt className="font-semibold text-foreground">{t('drawer.what')}</dt>
                  <dd className="mt-1 text-muted-foreground">{explanation.question}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-foreground">{t('drawer.why')}</dt>
                  <dd className="mt-1 text-muted-foreground">{explanation.why}</dd>
                </div>
                {status !== 'unknown' && (
                  <div>
                    <dt className="font-semibold text-foreground">{t('drawer.how')}</dt>
                    <dd className="mt-1 text-muted-foreground">{explanation.fix[status]}</dd>
                  </div>
                )}
              </dl>
            )}

            {actionable && <BeforeAfter weight={slot.bucket === 'geo' ? Math.round(slot.weight * geoScale * 100) / 100 : slot.weight} assessment={status} />}

            {snippet && <Snippet language={snippet.language} code={snippet.code} />}

            {actionable && (owner ? (
              <Link
                href={`/${lang}/dashboard`}
                data-testid="drawer-fix-pack"
                className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Sparkles aria-hidden="true" className="size-4" />{t('drawer.generate')}
              </Link>
            ) : (
              <button
                type="button"
                onClick={onSignup}
                data-testid="drawer-fix-pack"
                className="mt-auto inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <Sparkles aria-hidden="true" className="size-4" />{t('drawer.generate_signup')}
              </button>
            ))}
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

/** Now → after the fix, as two small status tiles and the points they carry. */
function BeforeAfter({ weight, assessment }: { weight: number; assessment: 'warn' | 'fail' }) {
  const t = useTranslations('resultPage')
  const visuals = useTranslations('visuals')
  const earned = assessment === 'warn' ? Math.round(weight * 50) / 100 : 0
  const gain = pointsToGain(weight, assessment)
  return (
    <figure className="rounded-xl border border-border p-3">
      <figcaption className="mb-2 text-xs font-semibold text-muted-foreground">{t('drawer.before_after')}</figcaption>
      <div className="flex items-center gap-2">
        <StatusTile label={t('drawer.before')} status={assessment} points={t('drawer.points', { earned: formatScanScore(earned), max: formatScanScore(weight) })} statusLabel={visuals(`status.${assessment}`)} />
        <ArrowRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <StatusTile label={t('drawer.after')} status="pass" points={t('drawer.points', { earned: formatScanScore(weight), max: formatScanScore(weight) })} statusLabel={visuals('status.pass')} />
        <span className="ml-auto shrink-0 rounded-full bg-tone-success-soft px-2 py-0.5 text-xs font-bold tabular-nums text-tone-success-fg">{t('fix_points', { points: formatScanScore(gain) })}</span>
      </div>
    </figure>
  )
}

function StatusTile({ label, status, points, statusLabel }: { label: string; status: CheckStatus; points: string; statusLabel: string }) {
  const tone = TONE_CLASSES[statusTone(status)]
  const Icon = STATUS_ICONS[status]
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col gap-1 rounded-lg border px-2.5 py-2', tone.soft, tone.border)}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('inline-flex items-center gap-1 text-sm font-semibold', tone.fg)}><Icon aria-hidden="true" className="size-3.5" />{statusLabel}</span>
      <span className="text-xs tabular-nums text-foreground">{points}</span>
    </div>
  )
}

function Snippet({ language, code }: { language: string; code: string }) {
  const t = useTranslations('resultPage')
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard unavailable: the code stays selectable */ }
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-neutral-2 px-3 py-1.5">
        <span className="text-xs font-semibold text-muted-foreground">{t('drawer.snippet')} · {language}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-foreground hover:bg-neutral-4 focus-visible:outline-2 focus-visible:outline-primary"
        >
          {copied ? <Check aria-hidden="true" className="size-3.5 text-tone-success-fg" /> : <Copy aria-hidden="true" className="size-3.5" />}
          <span aria-live="polite">{copied ? t('drawer.copied') : t('drawer.copy')}</span>
        </button>
      </div>
      <pre tabIndex={0} className="max-h-64 overflow-auto bg-neutral-1 p-3 text-xs leading-relaxed text-foreground"><code>{code}</code></pre>
    </div>
  )
}
