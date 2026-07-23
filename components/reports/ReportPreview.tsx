'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
} from 'lucide-react'
import type {
  ChangeKind,
  ClientReportSnapshotV1,
} from '@/lib/reports/types'
import { cn } from '@/lib/utils'

const SYSTEM_PRIMARY = '#1D4ED8'

export function contrastRatio(hex: string, against = '#FFFFFF'): number {
  const luminance = (value: string) => {
    const channels = value.slice(1).match(/.{2}/g)
    if (!channels || channels.length !== 3) return 0
    const linear = channels.map(channel => {
      const number = Number.parseInt(channel, 16) / 255
      return number <= 0.03928
        ? number / 12.92
        : ((number + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!
  }
  const first = luminance(hex)
  const second = luminance(against)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

export function accessibleReportPrimaryColor(color: string): string {
  return /^#[0-9A-Fa-f]{6}$/.test(color) && contrastRatio(color) >= 4.5
    ? color
    : SYSTEM_PRIMARY
}

export function reportInitialsForeground(color: string): '#000000' | '#FFFFFF' {
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return '#FFFFFF'
  return contrastRatio(color, '#000000') >= contrastRatio(color, '#FFFFFF')
    ? '#000000'
    : '#FFFFFF'
}

function safeDashboardProxyPath(value: string | null | undefined): string | null {
  return value
    && value.startsWith('/api/client-reports/')
    && !value.startsWith('//')
    ? value
    : null
}

function changeIcon(kind: ChangeKind) {
  if (kind === 'improved' || kind === 'added_coverage') return ArrowUpRight
  if (kind === 'regressed' || kind === 'lost_coverage') return ArrowDownRight
  if (kind === 'data_gap') return CircleAlert
  return ArrowRight
}

function changeClass(kind: ChangeKind) {
  if (kind === 'improved' || kind === 'added_coverage') return 'text-success'
  if (kind === 'regressed' || kind === 'lost_coverage') return 'text-destructive'
  return 'text-muted-foreground'
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'FA'
}

export function ReportPreview({
  snapshot,
  logoProxyUrl,
  contactProxyUrl,
}: {
  snapshot: ClientReportSnapshotV1
  logoProxyUrl?: string | null
  contactProxyUrl?: string | null
}) {
  const t = useTranslations('reports')
  const locale = useLocale()
  const [logoFailed, setLogoFailed] = useState(false)
  const primaryColor = accessibleReportPrimaryColor(snapshot.branding.primaryColor)
  const initialsForeground = reportInitialsForeground(primaryColor)
  const safeLogoProxyUrl = safeDashboardProxyPath(logoProxyUrl)
  const safeContactProxyUrl = safeDashboardProxyPath(contactProxyUrl)
  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' })
  const delta = snapshot.score.delta

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm">
      <header className="border-b border-border p-6 sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            {snapshot.branding.logoUrl && safeLogoProxyUrl && !logoFailed ? (
              // Version-scoped same-origin proxy URLs intentionally bypass the build-time host allowlist.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={safeLogoProxyUrl}
                width={48}
                height={48}
                alt={t('agency_logo_alt', { agency: snapshot.branding.agencyName })}
                className="size-12 shrink-0 rounded-xl object-contain"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <div
                className="flex size-12 shrink-0 items-center justify-center rounded-xl text-sm font-bold"
                style={{ backgroundColor: primaryColor, color: initialsForeground }}
                aria-hidden="true"
              >
                {initials(snapshot.branding.agencyName)}
              </div>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{snapshot.branding.agencyName}</p>
              <p className="text-sm text-muted-foreground">{t('prepared_for', { client: snapshot.client.name })}</p>
            </div>
          </div>
          <div className="text-left text-sm text-muted-foreground sm:text-right">
            <p>{snapshot.client.domain}</p>
            <p>{dateFormatter.format(new Date(snapshot.evidence.scanDate))}</p>
          </div>
        </div>
      </header>

      <div className="space-y-8 p-6 sm:p-8">
        <section aria-labelledby="report-summary-heading">
          <h2 id="report-summary-heading" className="text-lg font-semibold">
            {t('executive_summary')}
          </h2>
          <p className="mt-3 max-w-3xl whitespace-pre-wrap text-base leading-7 text-muted-foreground">
            {snapshot.executiveSummary}
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]" aria-labelledby="report-score-heading">
          <div className="rounded-xl border border-border bg-muted/30 p-5">
            <p id="report-score-heading" className="text-sm font-medium text-muted-foreground">
              {t('current_score')}
            </p>
            <div className="mt-2 flex items-end gap-3">
              <span className="text-4xl font-bold tabular-nums">{snapshot.score.current}</span>
              <span className="pb-1 text-sm font-semibold">{t('grade', { grade: snapshot.score.grade })}</span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {snapshot.score.comparisonState === 'baseline'
                ? t('comparison_baseline')
                : snapshot.score.comparisonState === 'not_comparable'
                  ? t('comparison_not_comparable')
                  : t('comparison_delta', {
                      delta: `${delta !== undefined && delta >= 0 ? '+' : ''}${delta ?? 0}`,
                    })}
            </p>
          </div>

          <div className="rounded-xl border border-border p-5">
            <h2 className="text-sm font-semibold">{t('measured_changes')}</h2>
            {snapshot.changes.length ? (
              <ul className="mt-3 space-y-3">
                {snapshot.changes.map(change => {
                  const Icon = changeIcon(change.kind)
                  return (
                    <li key={`${change.key}-${change.kind}`} className="flex items-start gap-3 text-sm">
                      <Icon className={cn('mt-0.5 size-4 shrink-0', changeClass(change.kind))} aria-hidden="true" />
                      <span>
                        <span className="font-medium">{change.label}</span>
                        <span className="ml-2 text-muted-foreground">{t(`change_${change.kind}`)}</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">{t('no_measured_changes')}</p>
            )}
          </div>
        </section>

        <section aria-labelledby="report-priorities-heading">
          <h2 id="report-priorities-heading" className="text-lg font-semibold">{t('priority_fixes')}</h2>
          {snapshot.priorityFixes.length ? (
            <ol className="mt-4 grid gap-4">
              {snapshot.priorityFixes.map((fix, index) => (
                <li key={fix.key} className="rounded-xl border border-border p-5">
                  <div className="flex items-start gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-semibold">{fix.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{fix.rationale}</p>
                      <p className="mt-3 flex items-start gap-2 text-sm">
                        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                        <span>{fix.nextStep}</span>
                      </p>
                      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {t('expected_impact', { impact: t(`impact_${fix.expectedImpact}`) })}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">{t('no_priority_fixes')}</p>
          )}
        </section>

        <section className="border-t border-border pt-6" aria-labelledby="report-methodology-heading">
          <h2 id="report-methodology-heading" className="text-sm font-semibold">{t('methodology')}</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">{snapshot.methodology}</p>
        </section>
      </div>

      <footer className="flex flex-col gap-3 border-t border-border bg-muted/20 px-6 py-5 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p className="font-semibold">{snapshot.branding.attribution}</p>
        {snapshot.branding.contactLabel && snapshot.branding.contactUrl && safeContactProxyUrl && (
          <a
            href={safeContactProxyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {snapshot.branding.contactLabel}
          </a>
        )}
      </footer>
    </article>
  )
}
