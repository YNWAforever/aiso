import Link from 'next/link'
import { useLocale, useTranslations } from 'next-intl'
import { Gauge, Minus, X } from 'lucide-react'
import { RevealHeatmap } from '@/components/visuals/reveal/RevealHeatmap'
import { PrintThemeGuard } from './PrintButton'
import { formatScanScore } from '@/lib/score-display'
import type { CombinedReportData, CombinedScan, CombinedPulse } from '@/lib/reports/combined'

/**
 * The combined scan + Pulse report: the latest saved website scan and the
 * latest classified canonical Pulse week on one printable page. Server-rendered
 * and read-only; the browser's print dialog is the PDF path. Missing data stays
 * an explicit empty/unavailable state, never a zero.
 */
export function CombinedReport({ report, clientId }: { report: CombinedReportData; clientId: string }) {
  const t = useTranslations('combinedReport')
  const locale = useLocale()
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
  const day = (iso: string) => date.format(new Date(iso))
  const preparedBy = report.branding?.agencyName ?? report.client.name

  return (
    <article
      className="combined-report mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-e2 print:max-w-none print:rounded-none print:border-0 print:shadow-none"
      data-testid="combined-report"
    >
      <style>{`@media print { @page { size: A4; margin: 12mm; } .combined-report { break-inside: auto; } }`}</style>
      <PrintThemeGuard />
      <header className="border-b border-border p-5 sm:p-8 print:px-0 print:pb-4 print:pt-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold">{preparedBy}</p>
            <p className="text-sm text-muted-foreground">{t('prepared_for', { client: report.client.name })}</p>
          </div>
          <p className="text-sm text-muted-foreground sm:text-right">{t('generated', { date: day(report.generatedAt) })}</p>
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight sm:text-3xl print:text-2xl">{t('title')}</h1>
        <p className="mt-1 break-all text-sm text-muted-foreground">{report.client.domain}</p>
      </header>

      <div className="space-y-5 p-5 sm:p-8 print:space-y-4 print:px-0 print:py-4">
        <ScanSection scan={report.scan} clientName={report.client.name} locale={locale} />
        <PulseSection pulse={report.pulse} activeQuestions={report.activeQuestions} clientId={clientId} locale={locale} />
      </div>

      <footer className="border-t border-border px-5 py-5 sm:px-8 print:px-0 print:py-3">
        <p className="text-xs leading-5 text-muted-foreground">{t('methodology')}</p>
        <p className="mt-3 text-xs text-muted-foreground">{t('prepared_by', { agency: preparedBy })}</p>
      </footer>
    </article>
  )
}

function ScanSection({ scan, clientName, locale }: { scan: CombinedScan; clientName: string; locale: string }) {
  const t = useTranslations('combinedReport')
  const checkNames = useTranslations('checks')
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })

  return (
    <section aria-labelledby="combined-scan-title" className="rounded-xl border border-border p-5 print:break-inside-avoid print:p-4">
      <h2 id="combined-scan-title" className="text-lg font-semibold">{t('scan_title')}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('scan_body', { client: clientName })}</p>

      {scan.state !== 'recorded' ? (
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {scan.state === 'none' ? t('scan_empty') : scan.state === 'unscored' ? t('scan_unscored') : t('scan_unavailable')}
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            <p className="inline-flex items-center gap-2 text-2xl font-bold tabular-nums">
              <Gauge aria-hidden="true" className="size-5 text-primary-accessible" />
              {t('score', { score: formatScanScore(scan.score) })}
            </p>
            {scan.grade && <p className="text-sm font-medium">{t('grade', { grade: scan.grade })}</p>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('scanned', { date: date.format(new Date(scan.scannedAt)) })}</p>
          {scan.collectionFailed && <p className="mt-2 text-sm text-tone-warning-fg">{t('scan_collection_failed')}</p>}
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {t('counts', {
              pass: scan.counts.pass,
              warn: scan.counts.warn,
              fail: scan.counts.fail,
              unknown: scan.counts.unknown,
            })}
            {scan.counts.notApplicable > 0 ? ` · ${t('counts_extra', { count: scan.counts.notApplicable })}` : ''}
          </p>

          <div className="mt-4">
            <RevealHeatmap
              checks={scan.checks.map(check => ({ ...check, label: checkNames(check.key) }))}
            />
          </div>

          <h3 className="mt-5 text-sm font-semibold">{t('issues_title')}</h3>
          {scan.issues.length ? (
            <ol className="mt-2 space-y-2">
              {scan.issues.map(issue => (
                <li key={issue.key} className="flex min-w-0 items-start gap-2 text-sm leading-6">
                  {issue.status === 'fail'
                    ? <X aria-hidden="true" className="mt-1 size-4 shrink-0 text-tone-danger-fg" />
                    : <Minus aria-hidden="true" className="mt-1 size-4 shrink-0 text-tone-warning-fg" />}
                  <div className="min-w-0">
                    <p className="font-medium">{issue.title}</p>
                    {issue.nextStep && <p className="text-muted-foreground">{t('issue_next_step', { step: issue.nextStep })}</p>}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t('no_issues')}</p>
          )}
        </>
      )}
    </section>
  )
}

function PulseSection({ pulse, activeQuestions, clientId, locale }: { pulse: CombinedPulse; activeQuestions: number | null; clientId: string; locale: string }) {
  const t = useTranslations('combinedReport')
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' })
  const platformLabels: Record<string, string> = {
    'gemini-flash': t('platform_gemini_flash'),
    'gpt-4o': t('platform_chatgpt'),
    'claude-haiku': t('platform_claude'),
    'perplexity-sonar': t('platform_perplexity'),
    'perplexity-sonar-pro': t('platform_perplexity_pro'),
  }
  const platformLabel = (key: string) => platformLabels[key] ?? key
  const rate = (value: number | null) => value === null ? t('mention_rate_none') : t('mention_rate', { value })

  return (
    <section aria-labelledby="combined-pulse-title" className="rounded-xl border border-border p-5 print:break-inside-avoid print:p-4">
      <h2 id="combined-pulse-title" className="text-lg font-semibold">{t('pulse_title')}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">{t('pulse_body')}</p>

      {pulse.state !== 'recorded' ? (
        <div className="mt-3">
          <p className="text-sm leading-6 text-muted-foreground">
            {pulse.state === 'none' ? t('pulse_empty') : t('pulse_unavailable')}
          </p>
          {pulse.state === 'none' && (
            <Link
              href={`/${locale}/dashboard/${clientId}?step=monitor#first-monitoring`}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-primary-accessible underline print:hidden"
            >
              {t('start_monitoring')}
            </Link>
          )}
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm font-medium">{t('pulse_week', { week: date.format(new Date(pulse.week)) })}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">{t('active_questions_label')}</dt>
              <dd className="font-semibold tabular-nums">{activeQuestions ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('answers_label')}</dt>
              <dd className="font-semibold tabular-nums">{pulse.answers}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('mentions_label')}</dt>
              <dd className="font-semibold tabular-nums">{pulse.brandMentions}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('rate_label')}</dt>
              <dd className="font-semibold tabular-nums">{rate(pulse.brandShare)}</dd>
            </div>
          </dl>

          {pulse.platforms.length > 0 && (
            <div className="mt-5 overflow-x-auto print:overflow-visible" tabIndex={0} role="region" aria-label={t('platforms_title')}>
              <table className="w-full min-w-[28rem] text-sm print:min-w-0">
                <caption className="mb-2 text-left font-semibold">{t('platforms_title')}</caption>
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="py-2 pr-4 font-medium">{t('platform')}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{t('answers_short')}</th>
                    <th scope="col" className="py-2 pr-4 font-medium">{t('mentions_short')}</th>
                    <th scope="col" className="py-2 font-medium">{t('rate_short')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pulse.platforms.map(platform => (
                    <tr key={platform.key} className="border-b last:border-0">
                      <th scope="row" className="py-2 pr-4 text-left font-normal">{platformLabel(platform.key)}</th>
                      <td className="py-2 pr-4 tabular-nums">{platform.answers}</td>
                      <td className="py-2 pr-4 tabular-nums">{platform.mentions}</td>
                      <td className="py-2 tabular-nums">{rate(platform.share)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-5 overflow-x-auto print:overflow-visible" tabIndex={0} role="region" aria-label={t('questions_title')}>
            <table className="w-full min-w-[28rem] text-sm print:min-w-0">
              <caption className="mb-2 text-left font-semibold">{t('questions_title')}</caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">{t('question')}</th>
                  <th scope="col" className="py-2 pr-4 font-medium">{t('answers_short')}</th>
                  <th scope="col" className="py-2 font-medium">{t('mentions_short')}</th>
                </tr>
              </thead>
              <tbody>
                {pulse.prompts.length ? pulse.prompts.map((prompt, index) => (
                  <tr key={`${prompt.question}-${index}`} className="border-b align-top last:border-0">
                    <th scope="row" className="py-2 pr-4 text-left font-normal">{prompt.question}</th>
                    <td className="py-2 pr-4 tabular-nums">{prompt.answers}</td>
                    <td className="py-2 tabular-nums">{prompt.brandMentions}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={3} className="py-2 text-muted-foreground">{t('questions_empty')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
