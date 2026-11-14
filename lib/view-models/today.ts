import type { WorkspaceHome } from './workspace-home'
import type { IllustrationName } from '@/components/ui/illustration'
import { taskHref } from '@/lib/tasks/navigation'
import type { TaskStatus } from '@/lib/tasks/status'

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
  | { kind: 'saved_work'; href: string; title: string; status: TaskStatus }

export type TodaySavedWork =
  | { state: 'empty' }
  | { state: 'unavailable'; href: string }
  | { state: 'ready'; href: string; title: string; status: TaskStatus }

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
  /** null means not requested; empty and unavailable are separate read outcomes. */
  savedWork: TodaySavedWork | null
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

function projectSavedWork(workspace: WorkspaceHome, lang: string): TodaySavedWork | null {
  const read = workspace.savedWork
  if (!read) return null
  if (read.status !== 'ok') return { state: 'unavailable', href: `/${lang}/dashboard/${encodeURIComponent(workspace.client.id)}/tasks` }
  // First unfinished in the returned activity order; never sort statuses or
  // infer that this capped cohort represents every saved task.
  const task = read.data.find(row => row.status !== 'delivered') ?? read.data[0]
  if (!task) return { state: 'empty' }
  return { state: 'ready', href: taskHref(lang, workspace.client.id, task), title: task.title, status: task.status }
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

  const savedWork = projectSavedWork(workspace, input.lang)
  // Only these typed, exact, unscoped fallback destinations may yield to saved
  // work. Setup/start, scoped runs/source/drafts, blockers and site fixes retain
  // their existing action and illustration, regardless of task status.
  const genericFallback = step && step.reasonKey === undefined && action.kind === 'next' && (
    (step.kind === 'review_results' && action.href === `${brand}/observations`) ||
    (step.kind === 'review_opportunity' && action.href === `${brand}/opportunities`)
  )
  if (!top && genericFallback && savedWork?.state === 'ready' && savedWork.status !== 'delivered') {
    action = { kind: 'saved_work', href: savedWork.href, title: savedWork.title, status: savedWork.status }
    illustration = 'tasks'
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
    savedWork,
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
