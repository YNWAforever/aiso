'use client'
import { AlertTriangle } from 'lucide-react'
import { useLocale } from 'next-intl'
import { getCheckActionCopy } from '@/lib/checkExplanations'
import type { ScanResults } from '@/lib/types'
import { resolveCheckPriorities, type CheckPriorityState } from '@/lib/view-models/check-priority'

const UI_EN = {
  label: 'YOUR #1 AI VISIBILITY ISSUE',
  quickFix: 'Quick fix:',
  severity: { warn: 'Warning', fail: 'Failed' },
  severityAria: (label: string) => `Severity: ${label}`,
  more: (n: number) =>
    `+ ${n} more issue${n > 1 ? 's' : ''} found — create a free account to see the full breakdown ↓`,
}

const UI_ZH_HK: typeof UI_EN = {
  label: '你的 #1 AI 可見度問題',
  quickFix: '快速修復：',
  severity: { warn: '警告', fail: '不及格' },
  severityAria: (label: string) => `嚴重程度：${label}`,
  more: (n: number) => `+ 還發現 ${n} 個問題——免費建立帳戶即可查看完整分析 ↓`,
}

interface Props {
  results: ScanResults & Record<string, unknown>
  failCount: number
  priorityState?: CheckPriorityState
  retryHref?: string
}

export function TopIssueCard({ results, failCount, priorityState, retryHref }: Props) {
  const locale = useLocale()
  const isZh = locale === 'zh-HK'
  const ui = isZh ? UI_ZH_HK : UI_EN

  const resolution = resolveCheckPriorities(results)
  const top = resolution.ranked[0]
  const state = top ? 'ready' : priorityState ?? resolution.state
  if (!top) {
    const copy = isZh ? {
      'insufficient-evidence': ['資料不足，暫未能選擇修復項目', '部分檢查未完成採集。重新掃描取得證據後，再確認改善項目。'],
      'all-clear': ['已採集的檢查沒有待修復項目', '本次檢查均通過；這並不代表已驗證搜尋平台的實際曝光。'],
      'not-applicable': ['本次檢查不適用', '沒有適用且已確認的修復項目。'],
      ready: ['', ''],
    } : {
      'insufficient-evidence': ['More evidence is needed before choosing a fix', 'Some checks could not be collected. Scan again to confirm what needs attention.'],
      'all-clear': ['No fixes found in the collected checks', 'The collected checks passed. Actual visibility on search platforms remains unverified.'],
      'not-applicable': ['These checks do not apply', 'There are no applicable, confirmed fixes in this scan.'],
      ready: ['', ''],
    }
    return <aside data-priority-state={state} className="rounded-2xl border border-border bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground">{copy[state][0]}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{copy[state][1]}</p>
      {state === 'insufficient-evidence' && <a href={retryHref ?? `/${isZh ? 'zh-HK' : 'en'}`} className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">{isZh ? '重新掃描' : 'Scan again'}</a>}
    </aside>
  }
  const topKey = top.checkKey
  const copy = getCheckActionCopy(topKey, locale)
  if (!copy) return null
  const issue = { headline: copy.title, why: copy.question, fix: copy.nextStep }

  const severity = top.assessment
  const severityLabel = ui.severity[severity]
  const styles = severity === 'warn'
    ? {
        card: 'border-amber-200 bg-amber-50',
        icon: 'bg-amber-500',
        eyebrow: 'text-amber-800',
        badge: 'bg-amber-100 text-amber-800 ring-amber-200',
        quickFix: 'border-amber-100',
        more: 'text-amber-700',
      }
    : {
        card: 'border-red-200 bg-red-50',
        icon: 'bg-red-500',
        eyebrow: 'text-red-700',
        badge: 'bg-red-100 text-red-800 ring-red-200',
        quickFix: 'border-red-100',
        more: 'text-red-700',
      }

  return (
    <div data-severity={severity} data-priority-check={topKey} className={`rounded-2xl border-2 p-6 ${styles.card}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className={`size-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${styles.icon}`}>
          <AlertTriangle className="size-4 text-white" />
        </div>
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <p className={`text-xs font-bold tracking-widest ${styles.eyebrow}`}>{ui.label}</p>
            <span
              aria-label={ui.severityAria(severityLabel)}
              className={`rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${styles.badge}`}
            >
              {severityLabel}
            </span>
          </div>
          <h2 className="text-lg font-black text-slate-900 leading-snug">{issue.headline}</h2>
        </div>
      </div>
      <p className="text-sm text-slate-600 leading-relaxed mb-4 pl-12">{issue.why}</p>
      <div className="pl-12">
        <div className={`flex items-center gap-1.5 text-xs text-slate-500 bg-white rounded-lg px-3 py-2 border inline-flex ${styles.quickFix}`}>
          <span className="font-semibold text-slate-700">{ui.quickFix}</span> {issue.fix}
        </div>
      </div>
      {failCount > 1 && (
        <p className={`pl-12 mt-4 text-xs font-semibold ${styles.more}`}>
          {ui.more(failCount - 1)}
        </p>
      )}
    </div>
  )
}
