import type { OwnedResultEvidence } from '@/lib/result-evidence'

const COPY = {
  en: {
    title: 'Collection evidence', absent: 'No verifiable collection evidence is available for this historical scan.',
    scope: 'This scan has origin-only scope. No comparable improvement claim is available from this result.',
    collection: 'Collection', pages: 'Completed pages', collected: 'Collected at', scanner: 'Scanner', method: 'Methodology',
    limited: 'Collection is limited; missing observations are not measured failures or zero scores.', check: 'Check', assessment: 'Assessment',
    states: { complete: 'Complete', partial: 'Partial', blocked: 'Blocked', failed: 'Failed', unsupported: 'Unsupported', unknown: 'Unknown', pass: 'Pass', warn: 'Warning', fail: 'Fail', 'not-verifiable': 'Not verifiable', 'not-applicable': 'Not applicable' },
  },
  'zh-HK': {
    title: '採集證據', absent: '此歷史掃描未有可核實的採集證據。',
    scope: '此掃描僅涵蓋網站來源範圍，不能據此聲稱可比較的改善。',
    collection: '採集狀態', pages: '已完成頁數', collected: '採集時間', scanner: '掃描器', method: '方法版本',
    limited: '採集範圍有限；缺少觀測不代表已測得失敗或零分。', check: '檢查', assessment: '評估',
    states: { complete: '完整', partial: '部分', blocked: '受阻', failed: '失敗', unsupported: '不支援', unknown: '未知', pass: '通過', warn: '警告', fail: '不及格', 'not-verifiable': '無法核實', 'not-applicable': '不適用' },
  },
} as const

export function ScanEvidencePanel({ evidence, locale }: { evidence: OwnedResultEvidence | null; locale: string }) {
  const copy = COPY[locale === 'zh-HK' ? 'zh-HK' : 'en']
  const label = (state: string) => copy.states[state as keyof typeof copy.states] ?? copy.states.unknown
  return (
    <section aria-label={copy.title} data-testid="owned-scan-evidence" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-700">
      <h2 className="font-bold text-slate-900">{copy.title}</h2>
      <p className="mt-2 text-xs leading-relaxed">{copy.scope}</p>
      {!evidence ? <p className="mt-3">{copy.absent}</p> : <>
        {evidence.limited && <p className="mt-3 text-xs">{copy.limited}</p>}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <dt>{copy.collection}</dt><dd>{label(evidence.collection)}</dd>
          <dt>{copy.pages}</dt><dd>{evidence.completedPages}</dd>
          <dt>{copy.collected}</dt><dd>{evidence.collectedAt ? <time dateTime={evidence.collectedAt}>{evidence.collectedAt}</time> : copy.states.unknown}</dd>
          <dt>{copy.scanner}</dt><dd>{evidence.scannerVersion}</dd>
          <dt>{copy.method}</dt><dd>{evidence.methodologyVersion}</dd>
        </dl>
        <details className="mt-4">
          <summary className="cursor-pointer font-semibold">{copy.check} / {copy.collection} / {copy.assessment}</summary>
          <ul className="mt-2 space-y-2 text-xs">{evidence.checks.map(check => <li key={check.key}>
            <span className="font-mono">{check.key}</span>: {label(check.collection)} · {label(check.assessment)}
          </li>)}</ul>
        </details>
      </>}
    </section>
  )
}
