import type { WorkspaceHome } from './workspace-home'
import type { IllustrationName } from '@/components/ui/illustration'

/**
 * The brand Today projection: one recommended action, at most three numbers, the
 * setup remainder and the month entry. Pure derivation from the existing
 * WorkspaceHome projection — it never re-scores checks or invents a figure.
 * Copy lives in messages (`today.*`); this model only carries keys and states.
 */

export type TodayAction =
  | { kind: 'fix'; href: string; checkKey: string; points: number }
  | { kind: 'next'; href: string; labelKey: NextStepKey; reasonKey?: NonNullable<WorkspaceHome['nextStep']>['reasonKey'] }
  | { kind: 'none'; href: string }

export type NextStepKey = keyof {
  configure: string; start: string; repair: string; results: string; opportunities: string
  review: string; status: string; work: string; scan: string
}

export type TodayMetricKey = 'visibility' | 'score' | 'report'
export type TodayMetricState = 'ready' | 'empty' | 'error' | 'locked' | 'unknown'
export interface TodayMetric {
  key: TodayMetricKey
  /** Display value, or null when the honest answer is 未記錄／未能讀取. */
  value: string | null
  state: TodayMetricState
  href: string
}

export interface TodayView {
  brandName: string
  domain: string | null
  action: TodayAction
  illustration: IllustrationName
  /** At most three: AI visibility, scan score, this month's report. */
  metrics: TodayMetric[]
  /** Number of unfinished first-run steps; the brand step is already satisfied. */
  setup: { remaining: number; currentKey: string } | null
  monthlyReport: WorkspaceHome['monthlyReport']
  links: {
    results: string | null
    monitor: string
    improve: string
    reports: string
    scan: string
    roi: string
  }
}

export function buildTodayView(workspace: WorkspaceHome, input: { lang: string; client_reports_online?: boolean }): TodayView {
  const brand = `/${input.lang}/dashboard/${workspace.client.id}`
  const health = workspace.siteHealth.data
  const visibility = workspace.visibility.data
  const top = workspace.priorities.state === 'ready' ? workspace.priorities.primaryAction : null
  const step = workspace.nextStep
  // Retain the existing site-fix priority for generic monitoring/setup links.
  // Scoped saved-run links must continue to open that exact work, not a website fix.
  const monitorBound = !!step && (step.href.includes('?step=monitor') || /\/(?:prompts|observations)$/.test(step.href))

  let action: TodayAction
  let illustration: IllustrationName
  if (monitorBound && top && health) {
    action = { kind: 'fix', href: `${brand}?step=results&scanId=${encodeURIComponent(health.scanId)}`, checkKey: top.checkKey, points: Number(top.pointsAtStake.toFixed(1)) }
    illustration = 'fixes'
  } else if (step) {
    // The workspace projector is locale-neutral. Only replace its path prefix;
    // retain the exact destination, query, fragment, action and blocking reason.
    const href = step.href.replace(/^\/__locale__\//, `/${input.lang}/`)
    action = { kind: 'next', href, labelKey: step.labelKey, ...(step.reasonKey ? { reasonKey: step.reasonKey } : {}) }
    illustration = action.href.includes('?step=scan') ? 'scan' : 'tasks'
  } else {
    action = { kind: 'none', href: `${brand}?step=scan` }
    illustration = 'scan'
  }

  const metrics: TodayMetric[] = [
    {
      key: 'visibility',
      value: visibility ? `${Number(visibility.sovScore.toFixed(1))}%` : null,
      state: workspace.visibility.state === 'ready' || workspace.visibility.state === 'partial' ? 'ready' : workspace.visibility.state === 'error' ? 'unknown' : workspace.visibility.state === 'locked' ? 'locked' : 'empty',
      href: `${brand}?step=monitor`,
    },
    {
      key: 'score',
      value: health && health.score !== null ? String(health.score) : null,
      state: !health || health.score === null ? 'unknown' : 'ready',
      href: health ? `${brand}?step=results&scanId=${encodeURIComponent(health.scanId)}` : `${brand}?step=results`,
    },
    {
      key: 'report',
      value: workspace.monthlyReport ? workspace.monthlyReport.month : null,
      state: !input.client_reports_online ? 'locked' : workspace.monthlyReport ? 'ready' : 'empty',
      href: workspace.monthlyReport ? `${brand}/month/report?m=${encodeURIComponent(workspace.monthlyReport.month)}` : `${brand}/reports`,
    },
  ]

  const steps = workspace.gettingStarted?.steps ?? null
  const current = steps?.find(step => step.state === 'current') ?? null
  const setup = steps && current ? { remaining: steps.length - (workspace.gettingStarted?.done ?? 0), currentKey: current.key } : null

  return {
    brandName: workspace.client.brand_name,
    domain: workspace.client.domain,
    action,
    illustration,
    metrics,
    setup,
    monthlyReport: workspace.monthlyReport ?? null,
    links: {
      results: health ? `${brand}?step=results&scanId=${encodeURIComponent(health.scanId)}` : null,
      monitor: `${brand}?step=monitor`,
      improve: `${brand}?step=improve`,
      reports: `${brand}/reports`,
      scan: `${brand}?step=scan`,
      roi: `${brand}?step=roi`,
    },
  }
}
