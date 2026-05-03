import { ScoreRing } from '@/components/ScoreRing'
import { ExpandableCheckItem } from '@/components/ExpandableCheckItem'
import { CHECK_EXPLANATIONS } from '@/lib/checkExplanations'
import type { Scan, CheckResult } from '@/lib/types'

type Props = {
  scan: Pick<Scan, 'id' | 'score' | 'grade' | 'domain' | 'created_at' | 'results'>
}

const CORE_CHECK_KEYS = [
  'c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability',
] as const

const EXTENDED_CHECK_KEYS = [
  'c6_llms_full_txt', 'c7_mcp_card', 'c8_sitemap', 'c9_meta_desc', 'c10_headings',
  'c11_faq', 'c12_canonical', 'c13_render', 'c14_internal_links', 'c15_entity', 'c16_freshness',
] as const

const GEO_CHECK_KEYS = [
  'c17_citation_density', 'c18_factual_density', 'c19_topical_authority', 'c20_chunkability',
] as const

type CheckGroup = {
  title: string
  keys: readonly string[]
  maxPoints: number
}

export function ScanSummary({ scan }: Props) {
  const r = scan.results as Record<string, unknown>
  const grade = scan.grade ?? 'F'
  const date = new Date(scan.created_at).toLocaleDateString()

  const groups: CheckGroup[] = [
    { title: 'Core Checks', keys: CORE_CHECK_KEYS as unknown as string[], maxPoints: 45 },
    { title: 'Extended Checks', keys: EXTENDED_CHECK_KEYS as unknown as string[], maxPoints: 30 },
    { title: 'GEO Checks', keys: GEO_CHECK_KEYS as unknown as string[], maxPoints: 25 },
  ]

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-slate-700">Latest Scan</p>
          <p className="text-xs text-slate-400">{scan.domain} &middot; {date}</p>
        </div>
        <ScoreRing score={scan.score} />
      </div>

      <div className="flex items-center gap-2 mb-4">
        <span className="text-lg font-bold text-slate-900">Grade {grade}</span>
      </div>

      <div className="space-y-2">
        {groups.map((group) => {
          const checks = group.keys
            .map(key => ({ key, result: r[key] as CheckResult | undefined }))
            .filter(c => c.result)
          if (checks.length === 0) return null

          const passed = checks.filter(c => c.result?.status === 'pass').length
          const pct = Math.round((passed / checks.length) * 100)

          return (
            <details key={group.title} className="group">
              <summary className="cursor-pointer flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-50 list-none">
                <span className="text-xs font-medium text-slate-600">{group.title} ({passed}/{checks.length})</span>
                <div className="flex items-center gap-2">
                  <div className="w-16 h-1.5 rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${pct >= 60 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <svg className={`w-3 h-3 text-slate-400 transition-transform group-open:rotate-180`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </summary>
              <div className="mt-1 space-y-0.5">
                {checks.map(({ key, result }) => {
                  const explanation = CHECK_EXPLANATIONS[key]
                  return (
                    <ExpandableCheckItem
                      key={key}
                      label={key.replace(/^c\d+_/, '').replace(/_/g, ' ')}
                      result={result!}
                      message={result!.message}
                      explanation={explanation ?? undefined}
                    />
                  )
                })}
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}
