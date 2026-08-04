import type { ChangeKind, ComparisonState, ReportLocale } from './types'

export interface ReportSummaryInput {
  readonly locale: ReportLocale
  readonly comparisonState: ComparisonState
  readonly currentScore: number
  readonly delta?: number
  readonly changes: ReadonlyArray<{ kind: ChangeKind }>
}

export function buildDeterministicReportSummary(input: ReportSummaryInput): string {
  const changes = input.changes.filter(change => change.kind !== 'unchanged').length
  if (input.locale === 'zh-HK') {
    if (input.comparisonState === 'baseline') return `這是目前分數 ${input.currentScore} 的基準報告，已記錄 ${changes} 項可報告檢查結果。`
    if (input.comparisonState === 'not_comparable') return `目前分數為 ${input.currentScore}，但現有證據與較早掃描不具可比性。`
    return `目前分數為 ${input.currentScore}，較早掃描的差異為 ${(input.delta ?? 0) >= 0 ? '+' : ''}${input.delta ?? 0}，並記錄 ${changes} 項證據變化。`
  }
  if (input.comparisonState === 'baseline') return `This baseline report records a current score of ${input.currentScore} and ${changes} reportable evidence changes.`
  if (input.comparisonState === 'not_comparable') return `The current score is ${input.currentScore}, but the available evidence is not comparable with the earlier scan.`
  return `The current score is ${input.currentScore}, a signed change of ${(input.delta ?? 0) >= 0 ? '+' : ''}${input.delta ?? 0}, with ${changes} evidence changes recorded.`
}
