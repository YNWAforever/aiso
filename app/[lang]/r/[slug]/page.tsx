import type { CSSProperties } from 'react'
import type { Metadata } from 'next'
import {
  AlertCircle,
  CheckCircle2,
  CircleMinus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { notFound } from 'next/navigation'
import {
  resolvePublishedClientReport,
} from '@/lib/reports/public'
import { incrementClientReportView } from '@/lib/reports/store'
import type { ChangeKind, ReportLocale } from '@/lib/reports/types'

type PublicReportPageProps = {
  params: Promise<{ lang: string; slug: string }>
  searchParams: Promise<{ v?: string | string[]; s?: string | string[] }>
}

const copy = {
  en: {
    title: 'Client report — Fimmick AISO',
    preparedFor: 'Prepared for',
    published: 'Published',
    evidence: 'Evidence captured',
    summary: 'Executive summary',
    score: 'Current AISO score',
    grade: 'Grade',
    baseline: 'This report establishes the first measured benchmark; no earlier eligible scan is available.',
    notComparable: 'Earlier evidence used a different coverage shape, so no score change is claimed.',
    delta: 'Measured change from the closest eligible scan',
    previous: 'Previous scan',
    changes: 'Measured changes',
    noChanges: 'No directly comparable check changes are available for this report.',
    priorities: 'Priority fixes',
    noPriorities: 'No priority fix was identified from the available evidence.',
    nextStep: 'Recommended next step',
    impact: 'Expected impact',
    methodology: 'Methodology and coverage',
    kinds: {
      improved: 'Improved',
      regressed: 'Regressed',
      unchanged: 'Unchanged',
      added_coverage: 'New coverage',
      lost_coverage: 'Coverage gap',
      data_gap: 'Data unavailable',
    },
    impacts: { high: 'High', medium: 'Medium', low: 'Low' },
  },
  'zh-HK': {
    title: '客戶報告 — Fimmick AISO',
    preparedFor: '為以下客戶準備',
    published: '發布日期',
    evidence: '實證擷取日期',
    summary: '管理層摘要',
    score: '目前 AISO 分數',
    grade: '評級',
    baseline: '此報告建立首個實證基準，暫未有較早的合資格掃描可供比較。',
    notComparable: '較早實證的覆蓋結構不同，因此不會聲稱分數有所變化。',
    delta: '相對最接近的合資格掃描，實測變化',
    previous: '上次掃描',
    changes: '實測變化',
    noChanges: '此報告暫未有可直接比較的檢查變化。',
    priorities: '優先改善項目',
    noPriorities: '現有實證未有識別出優先改善項目。',
    nextStep: '建議下一步',
    impact: '預期影響',
    methodology: '方法及覆蓋範圍',
    kinds: {
      improved: '有所改善',
      regressed: '表現倒退',
      unchanged: '維持不變',
      added_coverage: '新增覆蓋',
      lost_coverage: '覆蓋缺口',
      data_gap: '資料未能提供',
    },
    impacts: { high: '高', medium: '中', low: '低' },
  },
} as const

function reportLocale(value: string): ReportLocale {
  return value === 'zh-HK' ? 'zh-HK' : 'en'
}

function relativeLuminance(value: string): number {
  const channels = value.slice(1).match(/.{2}/g)
  if (!channels || channels.length !== 3) return 1
  const linear = channels.map(channel => {
    const component = Number.parseInt(channel, 16) / 255
    return component <= 0.03928
      ? component / 12.92
      : ((component + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
}

function reportColor(value: string): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(value)) return '#2563EB'
  const normalized = value.toUpperCase()
  const luminance = relativeLuminance(normalized)
  const contrastOnWhite = (1.05) / (luminance + 0.05)
  return contrastOnWhite >= 4.5 ? normalized : '#2563EB'
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'A'
}

function changePresentation(kind: ChangeKind) {
  if (kind === 'improved' || kind === 'added_coverage') {
    return { Icon: kind === 'improved' ? TrendingUp : CheckCircle2, className: 'text-success' }
  }
  if (kind === 'regressed' || kind === 'lost_coverage') {
    return { Icon: kind === 'regressed' ? TrendingDown : AlertCircle, className: 'text-destructive' }
  }
  if (kind === 'data_gap') return { Icon: AlertCircle, className: 'text-warning' }
  return { Icon: CircleMinus, className: 'text-muted-foreground' }
}

export async function generateMetadata({
  params,
  searchParams,
}: PublicReportPageProps): Promise<Metadata> {
  const [{ lang }] = await Promise.all([params, searchParams])
  return {
    title: copy[reportLocale(lang)].title,
    robots: { index: false, follow: false, nocache: true },
    referrer: 'no-referrer',
  }
}

export default async function PublicReportPage({
  params,
  searchParams,
}: PublicReportPageProps) {
  const [{ lang, slug }, query] = await Promise.all([params, searchParams])
  const locale = reportLocale(lang)
  const text = copy[locale]
  const resolved = await resolvePublishedClientReport({
    slug,
    version: query.v,
    signature: query.s,
  })
  if (!resolved) notFound()

  try {
    await incrementClientReportView({
      publicSlug: slug,
      shareVersion: Number(query.v),
    })
  } catch {
    // Aggregate engagement is best-effort and must never block a valid report.
  }

  const { report, publishedAt, logoProxyUrl, contactProxyUrl } = resolved.dto
  const primaryColor = reportColor(report.branding.primaryColor)
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const dateValue = (value: string) => date.format(new Date(value))
  const delta = report.score.delta

  return (
    <main
      className="min-h-dvh w-full overflow-x-clip bg-background px-4 py-6 text-foreground sm:px-6 sm:py-10 print:bg-white print:px-0 print:py-0"
      style={{ '--report-primary': primaryColor } as CSSProperties}
    >
      <style>{`
        @media print {
          @page { margin: 14mm; }
          .public-report { box-shadow: none !important; border-color: #d4d4d8 !important; }
          .public-report-contact { display: none !important; }
        }
      `}</style>
      <article className="public-report mx-auto w-full max-w-4xl overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm">
        <header className="border-b border-border p-5 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div
                className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: 'var(--report-primary)' }}
              >
                <span aria-hidden="true">{initials(report.branding.agencyName)}</span>
                {logoProxyUrl && (
                  // The same-origin proxy is the only public image source.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoProxyUrl}
                    width={48}
                    height={48}
                    alt={`${report.branding.agencyName} logo`}
                    className="absolute inset-0 size-12 bg-card object-contain"
                  />
                )}
              </div>
              <div className="min-w-0">
                <p className="break-words text-sm font-semibold">{report.branding.agencyName}</p>
                <p className="break-words text-sm text-muted-foreground">
                  {text.preparedFor} {report.client.name}
                </p>
              </div>
            </div>
            <dl className="grid gap-1 text-sm text-muted-foreground sm:text-right">
              <div><dt className="sr-only">{text.published}</dt><dd>{text.published}: {dateValue(publishedAt)}</dd></div>
              <div><dt className="sr-only">{text.evidence}</dt><dd>{text.evidence}: {dateValue(report.evidence.evidenceTimestamp)}</dd></div>
            </dl>
          </div>
          <div className="mt-6 min-w-0">
            <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{report.client.name}</h1>
            <p className="mt-1 break-all text-sm text-muted-foreground">{report.client.domain}</p>
          </div>
        </header>

        <div className="space-y-9 p-5 sm:p-8">
          <section aria-labelledby="public-summary-heading">
            <h2 id="public-summary-heading" className="text-lg font-semibold">{text.summary}</h2>
            <p className="mt-3 max-w-3xl whitespace-pre-wrap break-words text-base leading-7 text-muted-foreground">
              {report.executiveSummary}
            </p>
          </section>

          <section className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]" aria-labelledby="public-score-heading">
            <div className="min-w-0 rounded-xl border border-border bg-muted/30 p-5">
              <h2 id="public-score-heading" className="text-sm font-medium text-muted-foreground">{text.score}</h2>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <span className="text-4xl font-bold tabular-nums">{report.score.current}</span>
                <span className="pb-1 text-sm font-semibold">{text.grade} {report.score.grade}</span>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {report.score.comparisonState === 'baseline'
                  ? text.baseline
                  : report.score.comparisonState === 'not_comparable'
                    ? text.notComparable
                    : `${text.delta}: ${delta !== undefined && delta >= 0 ? '+' : ''}${delta}`}
              </p>
              {report.score.comparisonState === 'comparable' && report.score.previousScanDate && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {text.previous}: {dateValue(report.score.previousScanDate)}
                </p>
              )}
            </div>

            <div className="min-w-0 rounded-xl border border-border p-5">
              <h2 className="text-sm font-semibold">{text.changes}</h2>
              {report.changes.length ? (
                <ul className="mt-3 space-y-3">
                  {report.changes.map(change => {
                    const { Icon, className } = changePresentation(change.kind)
                    return (
                      <li key={`${change.key}-${change.kind}`} className="flex min-w-0 items-start gap-3 text-sm">
                        <Icon className={`mt-0.5 size-4 shrink-0 ${className}`} aria-hidden="true" />
                        <span className="min-w-0 break-words">
                          <span className="font-medium">{change.label}</span>
                          <span className="ml-2 text-muted-foreground">{text.kinds[change.kind]}</span>
                        </span>
                      </li>
                    )
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">{text.noChanges}</p>
              )}
            </div>
          </section>

          <section aria-labelledby="public-priorities-heading">
            <h2 id="public-priorities-heading" className="text-lg font-semibold">{text.priorities}</h2>
            {report.priorityFixes.length ? (
              <ol className="mt-4 grid min-w-0 gap-4">
                {report.priorityFixes.slice(0, 5).map((fix, index) => (
                  <li key={fix.key} className="min-w-0 rounded-xl border border-border p-5">
                    <div className="flex min-w-0 items-start gap-3">
                      <span
                        className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ backgroundColor: 'var(--report-primary)' }}
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <h3 className="break-words font-semibold">{fix.title}</h3>
                        <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{fix.rationale}</p>
                        <p className="mt-3 flex min-w-0 items-start gap-2 text-sm">
                          <CheckCircle2 className="mt-0.5 size-4 shrink-0" style={{ color: 'var(--report-primary)' }} aria-hidden="true" />
                          <span className="min-w-0 break-words"><span className="font-medium">{text.nextStep}:</span> {fix.nextStep}</span>
                        </p>
                        <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {text.impact}: {text.impacts[fix.expectedImpact]}
                        </p>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">{text.noPriorities}</p>
            )}
          </section>

          <section className="border-t border-border pt-6" aria-labelledby="public-methodology-heading">
            <h2 id="public-methodology-heading" className="text-sm font-semibold">{text.methodology}</h2>
            <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{report.methodology}</p>
          </section>
        </div>

        <footer className="flex flex-col gap-4 border-t border-border bg-muted/20 px-5 py-5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <p className="font-semibold">Powered by Fimmick AISO</p>
          {report.branding.contactLabel && contactProxyUrl && (
            <a
              href={contactProxyUrl}
              className="public-report-contact inline-flex min-h-11 w-full items-center justify-center rounded-md px-4 py-2 font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto"
              style={{ backgroundColor: 'var(--report-primary)', touchAction: 'manipulation' }}
            >
              {report.branding.contactLabel}
            </a>
          )}
        </footer>
      </article>
    </main>
  )
}
