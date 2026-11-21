import { formatDisplayDate } from '@/lib/format/date'
import { useLocale, useTranslations } from 'next-intl'
import { ScoreRing } from '@/components/ScoreRing'
import { ExpandableCheckItem } from '@/components/ExpandableCheckItem'
import { PillarScoreCards } from '@/components/PillarScoreCards'
import { getCheckExplanations } from '@/lib/checkExplanations'
import type { Scan, CheckResult } from '@/lib/types'
import { selectionQuery } from '@/lib/result/links'
import { resolveCheckPriorities } from '@/lib/view-models/check-priority'
import type { EvidenceCheckKey } from '@/lib/scan-evidence-versions'
import { factualDensityState } from '@/lib/factual-density-evidence'

type Props = {
  clientId: string
  focusedCheck?: EvidenceCheckKey
  scan: Pick<Scan, 'id' | 'score' | 'grade' | 'domain' | 'created_at' | 'results'>
}

const CORE_KEYS     = ['c1_robots', 'c2_llms_txt', 'c3_bot_access', 'c4_structured_data', 'c5_extractability'] as const
const EXTENDED_KEYS = ['c6_llms_full_txt', 'c7_mcp_card', 'c8_sitemap', 'c9_meta_desc', 'c10_headings', 'c11_faq', 'c12_canonical', 'c13_render', 'c14_internal_links', 'c15_entity', 'c16_freshness'] as const
const GEO_KEYS      = ['c17_citation_density', 'c18_factual_density', 'c19_topical_authority', 'c20_chunkability'] as const

type Group = { title: string; keys: readonly EvidenceCheckKey[]; accentVar: string }

const GROUPS: Group[] = [
  { title: 'Core',     keys: CORE_KEYS,     accentVar: '--dash-accent' },
  { title: 'Extended', keys: EXTENDED_KEYS, accentVar: '--dash-purple' },
  { title: 'GEO',      keys: GEO_KEYS,      accentVar: '--dash-success' },
]

export function ScanSummary({ scan, clientId, focusedCheck }: Props) {
  const t = useTranslations('dashboard')
  const checksT = useTranslations('checks')
  const verdictT = useTranslations('visuals.status')
  const locale = useLocale()
  // Resolved once, not per check. Reading CHECK_EXPLANATIONS directly showed
  // English copy to zh-HK users even though the translations existed.
  const explanations = getCheckExplanations(locale)
  const r = scan.results as Record<string, unknown>
  const { assessments } = resolveCheckPriorities(scan.results.evidence?.checks ?? {})
  function resultFor(key: EvidenceCheckKey): CheckResult | undefined {
    const result = r[key] as CheckResult | undefined
    if (result && typeof result.message === 'string') return result
    const status = assessments[key]
    if (status === 'pass' || status === 'warn' || status === 'fail') return { status, message: verdictT(status) }
  }
  const isPassing = (key: string) => (assessments[key] ?? (r[key] as CheckResult)?.status) === 'pass'
    && (key !== 'c18_factual_density' || factualDensityState(r.c18_factual_density_data ?? r.c18, (r[key] as CheckResult)?.diagnostic) === 'observed')
  const date = formatDisplayDate(scan.created_at, locale, {withTime:true})

  const totalChecks = GROUPS.reduce((s, g) => s + g.keys.length, 0)
  const totalPassed = GROUPS.reduce((s, g) => s + g.keys.filter(isPassing).length, 0)
  const healthPct = Math.round((totalPassed / totalChecks) * 100)

  const scoreColor = scan.score >= 80 ? 'var(--dash-success)' : scan.score >= 50 ? 'var(--dash-warning)' : 'var(--dash-danger)'

  return (
    <div className="rounded-xl border border-dash-border bg-dash-surface overflow-hidden">
      <div className="flex items-center justify-between p-5 border-b border-dash-border">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-dash-success animate-pulse" />
            <p className="text-xs font-semibold text-dash-muted tracking-widest uppercase">{t('selected_scan')}</p>
          </div>
          <p className="text-[12px] text-dash-muted font-mono mt-1">{scan.domain}</p>
          <p className="text-[10px] text-dash-muted font-mono mt-0.5">{date}</p>
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
        {scan.grade && <span className="text-lg font-bold font-mono text-dash-text">
          {t('grade')} <span style={{ color: scoreColor }}>{scan.grade}</span>
        </span>}
        <span className="text-[11px] text-dash-muted">{t('score_outof', { score: scan.score })}</span>
      </div>

      <div className="border-b border-dash-border p-5">
        <PillarScoreCards results={r} locale={locale} tone="dashboard" />
      </div>

      <div className="p-4 space-y-1">
        {focusedCheck && !resultFor(focusedCheck) && <p id={`check-${focusedCheck}`} tabIndex={-1} className="p-3 text-sm">{checksT(focusedCheck)} · {t('check_unavailable')}</p>}
        {GROUPS.map((group) => {
          const checks = group.keys.map(key => ({ key, result: resultFor(key) })).filter(c => c.result)
          if (!checks.length) return null

          const passed = checks.filter(c => isPassing(c.key)).length
          const pct = Math.round((passed / checks.length) * 100)

          return (
            <details key={group.title} open={!!focusedCheck && group.keys.includes(focusedCheck)} className="group">
              <summary className="cursor-pointer flex items-center justify-between py-2 px-3 rounded-lg hover:bg-dash-elevated transition-colors list-none select-none">
                <div className="flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full" style={{ background: 'var(' + group.accentVar + ')' }} />
                  <span className="text-[11px] font-medium text-dash-muted font-mono">{group.title}</span>
                  <span className="text-[10px] text-dash-muted font-mono">{passed}/{checks.length}</span>
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
                  const explanation = explanations[key]
                  const assessment = assessments[key]
                  const actionable = assessment === 'warn' || assessment === 'fail'
                  return (
                    <ExpandableCheckItem key={key} label={checksT(key)} anchorId={`check-${key}`} initiallyOpen={key === focusedCheck}
                      result={result!} assessment={assessment} message={checksT.has(result!.message) ? checksT(result!.message) : result!.message} explanation={explanation}
                      factualState={key === 'c18_factual_density' ? factualDensityState(r.c18_factual_density_data ?? r.c18, result?.diagnostic) : undefined}>
                      {actionable && <a href={`/${locale}/dashboard/${encodeURIComponent(clientId)}/opportunities?${selectionQuery({scanId:scan.id, check:key})}`} className="inline-flex min-h-11 items-center font-semibold text-primary-accessible underline">{t('finding_task')}</a>}
                    </ExpandableCheckItem>
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
