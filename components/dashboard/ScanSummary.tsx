import { useLocale, useTranslations } from 'next-intl'
import { ScoreRing } from '@/components/ScoreRing'
import { ExpandableCheckItem } from '@/components/ExpandableCheckItem'
import { PillarScoreCards } from '@/components/PillarScoreCards'
import { CHECK_EXPLANATIONS } from '@/lib/checkExplanations'
import type { Scan, CheckResult } from '@/lib/types'

type Props = {
  scan: Pick<Scan, 'id' | 'score' | 'grade' | 'domain' | 'created_at' | 'results'>
}

const CORE_KEYS     = ['c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability'] as const
const EXTENDED_KEYS = ['c6_llms_full_txt', 'c7_mcp_card', 'c8_sitemap', 'c9_meta_desc', 'c10_headings', 'c11_faq', 'c12_canonical', 'c13_render', 'c14_internal_links', 'c15_entity', 'c16_freshness'] as const
const GEO_KEYS      = ['c17_citation_density', 'c18_factual_density', 'c19_topical_authority', 'c20_chunkability'] as const

type Group = { title: string; keys: readonly string[]; accentVar: string }

const GROUPS: Group[] = [
  { title: 'Core',     keys: CORE_KEYS,     accentVar: '--dash-accent' },
  { title: 'Extended', keys: EXTENDED_KEYS, accentVar: '--dash-purple' },
  { title: 'GEO',      keys: GEO_KEYS,      accentVar: '--dash-success' },
]

export function ScanSummary({ scan }: Props) {
  const t = useTranslations('dashboard')
  const locale = useLocale()
  const r = scan.results as Record<string, unknown>
  const date = new Date(scan.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const totalChecks = GROUPS.reduce((s, g) => s + g.keys.length, 0)
  const totalPassed = GROUPS.reduce((s, g) => s + g.keys.filter(k => (r[k] as CheckResult)?.status === 'pass').length, 0)
  const healthPct = Math.round((totalPassed / totalChecks) * 100)

  const scoreColor = scan.score >= 80 ? 'var(--dash-success)' : scan.score >= 50 ? 'var(--dash-warning)' : 'var(--dash-danger)'

  return (
    <div className="rounded-xl border border-dash-border bg-dash-surface overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-dash-border">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-dash-success animate-pulse" />
            <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase">{t('latest_scan')}</p>
          </div>
          <p className="text-[12px] text-dash-muted/80 font-mono mt-1">{scan.domain}</p>
          <p className="text-[10px] text-dash-muted/60 font-mono mt-0.5">{date}</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden sm:flex items-center gap-2">
            <div className="w-16 h-1 rounded-full bg-dash-border overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: healthPct + '%', background: scoreColor }} />
            </div>
            <span className="text-[10px] font-mono text-dash-muted">{totalPassed}/{totalChecks}</span>
          </div>
          <ScoreRing score={scan.score} />
        </div>
      </div>

      <div className="px-5 py-3 border-b border-dash-border flex items-center gap-3">
        <span className="text-lg font-bold font-mono text-dash-text">
          {t('grade')} <span style={{ color: scoreColor }}>{scan.grade ?? 'F'}</span>
        </span>
        <span className="text-[11px] text-dash-muted">{t('score_outof', { score: scan.score })}</span>
      </div>

      <div className="border-b border-dash-border p-5">
        <PillarScoreCards results={r} locale={locale} tone="dashboard" />
      </div>

      <div className="p-4 space-y-1">
        {GROUPS.map((group) => {
          const checks = group.keys.map(key => ({ key, result: r[key] as CheckResult | undefined })).filter(c => c.result)
          if (!checks.length) return null

          const passed = checks.filter(c => c.result?.status === 'pass').length
          const pct = Math.round((passed / checks.length) * 100)

          return (
            <details key={group.title} className="group">
              <summary className="cursor-pointer flex items-center justify-between py-2 px-3 rounded-lg hover:bg-dash-elevated transition-colors list-none select-none">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: 'var(' + group.accentVar + ')' }} />
                  <span className="text-[11px] font-medium text-dash-muted font-mono">{group.title}</span>
                  <span className="text-[10px] text-dash-muted/60 font-mono">{passed}/{checks.length}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="w-12 h-1 rounded-full bg-dash-border overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: pct + '%', background: scoreColor }} />
                  </div>
                  <svg className="w-3 h-3 text-dash-muted transition-transform duration-200 chevron-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </summary>
              <div className="mt-1 space-y-0.5 pl-7 pr-2">
                {checks.map(({ key, result }) => {
                  const explanation = CHECK_EXPLANATIONS[key]
                  const label = key.replace(/^c\d+_/, '').replace(/_/g, ' ')
                  return (
                    <ExpandableCheckItem key={key} label={label} result={result!} message={result!.message} explanation={explanation} />
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
