import { ScoreRing } from '@/components/ScoreRing'
import { ExpandableCheckItem } from '@/components/ExpandableCheckItem'
import { CHECK_EXPLANATIONS } from '@/lib/checkExplanations'
import type { Scan, CheckResult } from '@/lib/types'

type Props = {
  scan: Pick<Scan, 'id' | 'score' | 'grade' | 'domain' | 'created_at' | 'results'>
}

const CORE_KEYS     = ['c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability'] as const
const EXTENDED_KEYS = ['c6_llms_full_txt', 'c7_mcp_card', 'c8_sitemap', 'c9_meta_desc', 'c10_headings', 'c11_faq', 'c12_canonical', 'c13_render', 'c14_internal_links', 'c15_entity', 'c16_freshness'] as const
const GEO_KEYS      = ['c17_citation_density', 'c18_factual_density', 'c19_topical_authority', 'c20_chunkability'] as const

type Group = { title: string; keys: readonly string[]; accent: string; maxPts: number }

const GROUPS: Group[] = [
  { title: 'Core',     keys: CORE_KEYS,     accent: '#00d4ff', maxPts: 45 },
  { title: 'Extended', keys: EXTENDED_KEYS, accent: '#a78bfa', maxPts: 30 },
  { title: 'GEO',      keys: GEO_KEYS,      accent: '#22c55e', maxPts: 25 },
]

export function ScanSummary({ scan }: Props) {
  const r = scan.results as Record<string, unknown>
  const date = new Date(scan.created_at).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })

  const totalChecks = GROUPS.reduce((s, g) => s + g.keys.length, 0)
  const totalPassed = GROUPS.reduce((s, g) =>
    s + g.keys.filter(k => (r[k] as CheckResult)?.status === 'pass').length, 0)
  const healthPct = Math.round((totalPassed / totalChecks) * 100)

  return (
    <div className="rounded-xl border border-[#1e1e30] bg-[#0d0d18] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-[#1e1e30]">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
            <p className="text-xs font-semibold text-[#5c5c6e] tracking-widest uppercase">Latest Scan</p>
          </div>
          <p className="text-[12px] text-[#8c8c9e] font-mono mt-1">{scan.domain}</p>
          <p className="text-[10px] text-[#3c3c4e] font-mono mt-0.5">{date}</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Health bar */}
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-16 h-1 rounded-full bg-[#1e1e30] overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${healthPct}%`,
                  background: healthPct >= 70 ? '#22c55e' : healthPct >= 40 ? '#f59e0b' : '#ef4444',
                }} />
            </div>
            <span className="text-[10px] font-mono text-[#5c5c6e]">
              {totalPassed}/{totalChecks}
            </span>
          </div>
          <ScoreRing score={scan.score} />
        </div>
      </div>

      {/* Grade badge */}
      <div className="px-5 py-3 border-b border-[#1e1e30] flex items-center gap-3">
        <span className="text-lg font-bold font-mono text-[#e0e0ec]">
          Grade <span style={{ color: scan.score >= 80 ? '#22c55e' : scan.score >= 50 ? '#f59e0b' : '#ef4444' }}>
            {scan.grade ?? 'F'}
          </span>
        </span>
        <span className="text-[11px] text-[#5c5c6e]">
          Score {scan.score}/100
        </span>
      </div>

      {/* Check groups */}
      <div className="p-4 space-y-1">
        {GROUPS.map((group) => {
          const checks = group.keys
            .map(key => ({ key, result: r[key] as CheckResult | undefined }))
            .filter(c => c.result)
          if (!checks.length) return null

          const passed = checks.filter(c => c.result?.status === 'pass').length
          const warn   = checks.filter(c => c.result?.status === 'warn').length
          const pct    = Math.round((passed / checks.length) * 100)

          return (
            <details key={group.title} className="group">
              <summary className="cursor-pointer flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[#141422] transition-colors list-none select-none">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: group.accent }} />
                  <span className="text-[11px] font-medium text-[#8c8c9e] font-mono">{group.title}</span>
                  <span className="text-[10px] text-[#5c5c6e] font-mono">{passed}/{checks.length}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="w-12 h-1 rounded-full bg-[#1e1e30] overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 60 ? '#22c55e' : pct >= 30 ? '#f59e0b' : '#ef4444',
                      }} />
                  </div>
                  <svg className="w-3 h-3 text-[#5c5c6e] transition-transform duration-200 chevron-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </summary>
              <div className="mt-1 space-y-0.5 pl-7 pr-2">
                {checks.map(({ key, result }, i) => {
                  const explanation = CHECK_EXPLANATIONS[key]
                  const label = key.replace(/^c\d+_/, '').replace(/_/g, ' ')
                  return (
                    <ExpandableCheckItem
                      key={key}
                      label={label}
                      status={result!.status}
                      message={result!.message}
                      details={result!.details}
                      explanation={explanation ? { why: explanation.why, fix: explanation.fix[result!.status] } : undefined}
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
