import type { CSSProperties } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { CheckCircle2 } from 'lucide-react'
import type { HeatmapCheck } from '@/components/visuals/CheckHeatmap'
import { RevealHeatmap } from '@/components/visuals/reveal/RevealHeatmap'
import { RevealScoreRing } from '@/components/visuals/reveal/RevealScoreRing'
import { RevealObserver } from '@/components/visuals/reveal/RevealObserver'
import { getCheckActionCopy } from '@/lib/checkExplanations'
import { accessibleReportPrimaryColor, reportInitialsForeground } from '@/lib/reports/colors'
import type { ClientReportSnapshotV1, PublicClientReportSnapshot } from '@/lib/reports/types'
import { buildReportPage, type ReportFixView } from '@/lib/view-models/report-page'
import { PrintButton, PrintThemeGuard } from './PrintButton'
import { ReportLogo } from './ReportLogo'
import { ReportTrend } from './ReportTrend'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'FA'
}

/** Only same-origin report proxies are ever used as an image or link. */
function safeProxyPath(value: string | null | undefined): string | null {
  return value
    && (value.startsWith('/api/client-reports/') || value.startsWith('/api/public/client-reports/'))
    && !value.startsWith('//')
    ? value
    : null
}

export type OnePageReportProps = {
  snapshot: ClientReportSnapshotV1 | PublicClientReportSnapshot
  /** `page` owns the document's h1 (the public link); `embedded` sits under a page heading. */
  variant: 'page' | 'embedded'
  /** Show "Download PDF" in the header. */
  printable?: boolean
  publishedAt?: string | null
  logoProxyUrl?: string | null
  contactProxyUrl?: string | null
}

/**
 * The client report on one page: score ring, trend, every check as a heatmap
 * and the top three fixes, with the summary and method in a sentence each.
 * The same component is the public link, the dashboard preview and the sample,
 * and prints to a single A4 page ("Download PDF").
 */
export function OnePageReport({ snapshot, variant, printable = false, publishedAt, logoProxyUrl, contactProxyUrl }: OnePageReportProps) {
  const t = useTranslations('reports')
  const page = useTranslations('reportPage')
  const checkNames = useTranslations('checks')
  const locale = useLocale()
  const view = buildReportPage(snapshot as ClientReportSnapshotV1)
  const primary = accessibleReportPrimaryColor(snapshot.branding.primaryColor)
  const onPrimary = reportInitialsForeground(primary)
  const logo = safeProxyPath(logoProxyUrl)
  const contact = snapshot.branding.contactLabel ? safeProxyPath(contactProxyUrl) : null
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
  const day = (iso: string) => date.format(new Date(iso))
  const Title = variant === 'page' ? 'h1' : 'h2'
  const Section = variant === 'page' ? 'h2' : 'h3'
  const heatmap: HeatmapCheck[] | null = view.heatmap?.map(tile => ({ ...tile, label: checkNames(tile.key) })) ?? null
  const delta = snapshot.score.delta

  return (
    <article
      className="one-page-report mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-e2 print:max-w-none print:rounded-none print:border-0 print:shadow-none"
      style={{ '--report-primary': primary, '--report-on-primary': onPrimary } as CSSProperties}
      data-testid="one-page-report"
    >
      {/* One A4 page: the print classes below fit the report inside these margins. */}
      <style>{'@media print { @page { size: A4; margin: 12mm; } .one-page-report { zoom: 0.92; } }'}</style>
      <RevealObserver />
      <PrintThemeGuard />
      <header className="border-b border-border p-5 sm:p-8 print:px-0 print:pb-4 print:pt-0">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between print:flex-row">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-bold"
              style={{ backgroundColor: 'var(--report-primary)', color: 'var(--report-on-primary)' }}
            >
              <span aria-hidden="true">{initials(snapshot.branding.agencyName)}</span>
              {logo && <ReportLogo src={logo} alt={t('agency_logo_alt', { agency: snapshot.branding.agencyName })} />}
            </div>
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold">{snapshot.branding.agencyName}</p>
              <p className="break-words text-sm text-muted-foreground">{t('prepared_for', { client: snapshot.client.name })}</p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:items-end print:items-end">
            {printable && <PrintButton />}
            <div className="grid gap-0.5 text-sm text-muted-foreground sm:text-right print:text-right">
              {publishedAt && <p>{page('published', { date: day(publishedAt) })}</p>}
              <p>{page('evidence', { date: day(snapshot.evidence.evidenceTimestamp) })}</p>
            </div>
          </div>
        </div>
        <div className="mt-5 min-w-0 print:mt-3">
          <Title className="break-words text-2xl font-bold tracking-tight sm:text-3xl print:text-2xl">{snapshot.client.name}</Title>
          <p className="mt-1 break-all text-sm text-muted-foreground">{snapshot.client.domain}</p>
          <p className="mt-4 max-w-3xl whitespace-pre-wrap break-words text-base leading-7 text-muted-foreground print:mt-2 print:text-xs print:leading-5">
            <span className="sr-only">{t('executive_summary')}: </span>
            {snapshot.executiveSummary}
          </p>
        </div>
      </header>

      <div className="grid gap-4 p-5 sm:p-8 md:grid-cols-2 print:grid-cols-2 print:gap-3 print:px-0 print:py-3">
        <section data-reveal aria-labelledby="report-score-heading" className="min-w-0 rounded-xl border border-border p-5 print:break-inside-avoid print:p-4">
          <Section id="report-score-heading" className="text-sm font-semibold text-muted-foreground">{t('current_score')}</Section>
          <div className="mt-3 flex flex-wrap items-center gap-5 print:flex-nowrap print:gap-4">
            <RevealScoreRing score={view.score.current} grade={view.score.grade} previous={view.score.previous} size="md" />
            <div className="min-w-0 flex-1 basis-40 space-y-2 text-sm leading-6 text-muted-foreground print:space-y-1 print:text-xs print:leading-5">
              <p className="font-semibold text-foreground">{t('grade', { grade: view.score.grade })}</p>
              <p>
                {view.comparisonState === 'baseline'
                  ? t('comparison_baseline')
                  : view.comparisonState === 'not_comparable'
                    ? t('comparison_not_comparable')
                    : t('comparison_delta', { delta: `${delta !== undefined && delta >= 0 ? '+' : ''}${delta ?? 0}` })}
              </p>
              {view.comparisonState === 'comparable' && snapshot.score.previousScanDate && (
                <p className="text-xs">{page('previous_scan', { date: day(snapshot.score.previousScanDate) })}</p>
              )}
              {view.comparisonState === 'comparable' && (
                <p className="text-xs">{page('changes_summary', view.changeCounts)}</p>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="report-trend-heading" className="min-w-0 rounded-xl border border-border p-5 print:break-inside-avoid print:p-4">
          <Section id="report-trend-heading" className="text-sm font-semibold text-muted-foreground">{page('trend_title')}</Section>
          <div className="mt-3">
            {view.trend
              ? <ReportTrend trend={view.trend} methodChanged={view.methodChanged} />
              : <p className="text-sm text-muted-foreground">{page('trend_none')}</p>}
          </div>
        </section>

        <section data-reveal aria-labelledby="report-heatmap-heading" className="min-w-0 rounded-xl border border-border p-5 print:break-inside-avoid print:p-4">
          <Section id="report-heatmap-heading" className="text-sm font-semibold text-muted-foreground">{page('heatmap_title')}</Section>
          <div className="mt-3">
            {heatmap
              ? <RevealHeatmap checks={heatmap} />
              : <p className="text-sm text-muted-foreground">{page('heatmap_not_recorded')}</p>}
          </div>
        </section>

        <section aria-labelledby="report-fixes-heading" className="min-w-0 rounded-xl border border-border p-5 print:break-inside-avoid print:p-4">
          <Section id="report-fixes-heading" className="text-sm font-semibold text-muted-foreground">{page('fixes_title')}</Section>
          {view.fixes.length ? (
            <ol className="mt-3 grid gap-4 print:gap-2">
              {view.fixes.map((fix, index) => <FixItem key={fix.key} fix={fix} index={index} locale={locale} heading={variant === 'page' ? 'h3' : 'h4'} />)}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{t('no_priority_fixes')}</p>
          )}
        </section>
      </div>

      <footer className="border-t border-border px-5 py-5 sm:px-8 print:px-0 print:py-3">
        <p className="text-xs leading-5 text-muted-foreground">
          <span className="font-semibold text-foreground">{t('methodology')}: </span>
          {snapshot.methodology}
        </p>
        <div className="mt-4 flex flex-col gap-3 text-sm sm:flex-row sm:items-center sm:justify-between print:mt-2">
          <p className="font-semibold">{snapshot.branding.attribution}</p>
          {contact && (
            <a
              href={contact}
              target={variant === 'embedded' ? '_blank' : undefined}
              rel={variant === 'embedded' ? 'noopener noreferrer' : undefined}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto print:hidden"
              style={{ backgroundColor: 'var(--report-primary)', color: 'var(--report-on-primary)', touchAction: 'manipulation' }}
            >
              {snapshot.branding.contactLabel}
            </a>
          )}
        </div>
      </footer>
    </article>
  )
}

function FixItem({ fix, index, locale, heading: Heading }: { fix: ReportFixView; index: number; locale: string; heading: 'h3' | 'h4' }) {
  const t = useTranslations('reports')
  const page = useTranslations('reportPage')
  const checkNames = useTranslations('checks')
  const action = fix.kind === 'check' ? getCheckActionCopy(fix.checkKey, locale) : null
  const title = fix.kind === 'check' ? action?.title ?? checkNames(fix.checkKey) : fix.title
  const rationale = fix.kind === 'check' ? page(`fix_reason_${fix.reason}`, { check: checkNames(fix.checkKey) }) : fix.rationale
  const nextStep = fix.kind === 'check' ? action?.nextStep ?? null : fix.nextStep

  return (
    <li className="flex min-w-0 items-start gap-3 print:break-inside-avoid">
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold"
        style={{ backgroundColor: 'var(--report-primary)', color: 'var(--report-on-primary)' }}
      >
        {index + 1}
      </span>
      <div className="min-w-0">
        <Heading className="break-words font-semibold leading-6 print:text-sm">{title}</Heading>
        <p className="mt-1 break-words text-sm leading-6 text-muted-foreground print:text-xs print:leading-5">{rationale}</p>
        {nextStep && (
          <p className="mt-1.5 flex min-w-0 items-start gap-2 text-sm leading-6 print:mt-1 print:text-xs print:leading-5">
            <CheckCircle2 aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary-accessible" />
            <span className="min-w-0 break-words"><span className="font-medium">{page('next_step')}:</span> {nextStep}</span>
          </p>
        )}
        <p className="mt-1 text-xs font-medium text-muted-foreground">
          {t('expected_impact', { impact: t(`impact_${fix.impact}`) })}
        </p>
      </div>
    </li>
  )
}
