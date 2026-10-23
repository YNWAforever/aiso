'use client'
import { Brain, Link2, TrendingUp, Layers } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { factualDensityState, type FactualDensityView } from '@/lib/factual-density-evidence'
import { topicalAuthorityState } from '@/lib/topical-authority-evidence'

interface MetricBarProps { label: string; value: number; max?: number; color?: string }
function MetricBar({ label, value, max = 100, color = 'bg-primary' }: MetricBarProps) {
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(max) || max <= 0) return null
  const pct = Math.min(100, (value / max) * 100)
  const barColor = pct >= 60 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-muted">
        <div className={`h-full rounded-full ${color === 'auto' ? barColor : color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold text-foreground/80 w-12 text-right">{Math.round(value)}{max === 100 ? '/100' : ''}</span>
    </div>
  )
}

interface TierBadgeProps { tier: string; count: number; otherLabel: string }
function TierBadge({ tier, count, otherLabel }: TierBadgeProps) {
  const colors: Record<string, string> = {
    tier1: 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60',
    tier2: 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/60',
    tier3: 'bg-muted text-muted-foreground border-border',
    other: 'bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-300 border-orange-200 dark:border-orange-800/60',
  }
  const labels: Record<string, string> = { tier1: 'Tier 1', tier2: 'Tier 2', tier3: 'Tier 3', other: otherLabel }
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-semibold ${colors[tier] ?? colors.other}`}>
      <span>{labels[tier] ?? tier}</span>
      <span className="font-black">{count}</span>
    </div>
  )
}

type C17Data = { qualityScore?: number; authorityBreakdown?: Record<string, number>; citationsPerThousandWords?: number; totalLinks?: number; externalLinks?: number }
type C18Data = FactualDensityView
type C19Data = { topicalCoverageScore?: number; totalClusters?: number; hasOrphanPages?: number; detectedClusters?: { topic: string; completenessScore: number }[] }
type C20Data = { avgChunkLength?: number; optimalChunkRatio?: number; totalChunks?: number; hasFaqStyle?: boolean; chunkAnalysis?: { heading: string; extractabilityScore: number; isAnswerFirst?: boolean; isSelfContained?: boolean }[] }

interface Props {
  c17?: C17Data
  c18?: C18Data
  c19?: C19Data
  c19Check?: unknown
  c20?: C20Data
}

export function DeepGeoSection({ c17, c18, c19, c19Check, c20 }: Props) {
  const t = useTranslations('geoDetail')
  const strong = (chunks: ReactNode) => <strong className="text-foreground/80">{chunks}</strong>
  const c18State = factualDensityState(c18)
  const c19State = topicalAuthorityState(c19Check)
  if (!c17 && !c18 && !c19 && !c20) return null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Brain className="size-4 text-violet-500" />
        <h2 className="text-sm font-black text-foreground tracking-widest uppercase">{t('sectionTitle')}</h2>
        <span className="text-xs bg-violet-100 text-violet-700 font-bold px-2 py-0.5 rounded-full">{t('unlocked')}</span>
      </div>

      {/* C17 — Citation Density */}
      {c17 && (
        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-1">
            <Link2 className="size-4 text-blue-500" />
            <h3 className="text-sm font-bold text-foreground">{t('c17Title')}</h3>
            <span className="ml-auto text-xs text-muted-foreground">{t('checkNo', { n: 17 })}</span>
          </div>
          <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
            {t('c17Desc')}
          </p>
          <div className="space-y-3 mb-5">
            {c17.qualityScore !== undefined && (
              <MetricBar label={t('overallQuality')} value={c17.qualityScore} color="auto" />
            )}
            {c17.citationsPerThousandWords !== undefined && (
              <MetricBar label={t('citationsPer1k')} value={c17.citationsPerThousandWords} max={10} color="auto" />
            )}
          </div>
          {c17.authorityBreakdown && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-3">{t('authorityBreakdown')}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['tier1','tier2','tier3','other'] as const).map(tier => (
                  <TierBadge key={tier} tier={tier} count={c17.authorityBreakdown?.[tier] ?? 0} otherLabel={t('tierOther')} />
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {t('tierNote')}
              </p>
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-border flex gap-4 text-xs text-muted-foreground">
            {c17.totalLinks !== undefined && <span>{t.rich('totalLinks', { n: c17.totalLinks, strong })}</span>}
            {c17.externalLinks !== undefined && <span>{t.rich('externalLinks', { n: c17.externalLinks, strong })}</span>}
          </div>
        </div>
      )}

      {/* C18 — Factual Density */}
      {c18 && (
        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="size-4 text-emerald-500" />
            <h3 className="text-sm font-bold text-foreground">{t('c18Title')}</h3>
            <span className="ml-auto text-xs text-muted-foreground">{t('checkNo', { n: 18 })}</span>
          </div>
          <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
            {t('c18Desc')}
          </p>
          <div className="space-y-3 mb-5">
            {c18State !== 'observed' && <p className="text-xs text-muted-foreground" role="status">{c18State === 'legacy' ? t('c18Legacy') : t('c18Unavailable')}</p>}
            {c18State === 'observed' && typeof c18.qualityScore === 'number' && (
              <MetricBar label={t('overallQuality')} value={c18.qualityScore} color="auto" />
            )}
            {c18.numberDensity !== undefined && (
              <MetricBar label={t('numberDensity')} value={c18.numberDensity} max={10} color="auto" />
            )}
            {c18.namedEntityDensity !== undefined && (
              <MetricBar label={t('entityDensity')} value={c18.namedEntityDensity} max={10} color="auto" />
            )}
            {c18State === 'observed' && typeof c18.uniquenessScore === 'number' && (
              <MetricBar label={t('uniqueness')} value={c18.uniquenessScore} color="auto" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {c18.dateReferences !== undefined && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${(c18.dateReferences ?? 0) > 0 ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60' : 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 border-red-200 dark:border-red-800/60'}`}>
                {t('dateRefs', { n: c18.dateReferences })}
              </span>
            )}
            {c18.hasComparativeData !== undefined && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${c18.hasComparativeData ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60' : 'bg-muted/50 text-muted-foreground border-border'}`}>
                {c18.hasComparativeData ? '✓' : '✗'} {t('comparativeData')}
              </span>
            )}
            {c18.hasTimeSeriesData !== undefined && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${c18.hasTimeSeriesData ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60' : 'bg-muted/50 text-muted-foreground border-border'}`}>
                {c18.hasTimeSeriesData ? '✓' : '✗'} {t('timeSeriesData')}
              </span>
            )}
          </div>
        </div>
      )}

      {/* C19 — Topical Authority */}
      {c19 && (
        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-1">
            <Layers className="size-4 text-violet-500" />
            <h3 className="text-sm font-bold text-foreground">{t('c19Title')}</h3>
            <span className="ml-auto text-xs text-muted-foreground">{t('checkNo', { n: 19 })}</span>
          </div>
          <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
            {t('c19Desc')}
          </p>
          {c19State !== 'observed' && <p className="text-xs text-muted-foreground" role="status">{c19State === 'legacy' ? t('c19Legacy') : t('c19Unavailable')}</p>}
          {c19State === 'observed' && <>
          <div className="space-y-3 mb-5">
            {c19.topicalCoverageScore !== undefined && (
              <MetricBar label={t('coverageScore')} value={c19.topicalCoverageScore} color="auto" />
            )}
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${(c19.totalClusters ?? 0) > 0 ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60' : 'bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-300 border-red-200 dark:border-red-800/60'}`}>
              {t('clustersDetected', { n: c19.totalClusters ?? 0 })}
            </span>
            {(c19.hasOrphanPages ?? 0) > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/60">
                {t('orphanPages', { n: c19.hasOrphanPages ?? 0 })}
              </span>
            )}
          </div>
          {(c19.detectedClusters?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground mb-2">{t('detectedClusters')}</p>
              {c19.detectedClusters!.slice(0, 5).map((cl, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground flex-1 truncate capitalize">{cl.topic}</span>
                  <div className="w-24 h-1.5 rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${cl.completenessScore >= 60 ? 'bg-emerald-500' : cl.completenessScore >= 30 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${cl.completenessScore}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground w-8 text-right">{Math.round(cl.completenessScore)}%</span>
                </div>
              ))}
            </div>
          )}
          </>}
        </div>
      )}

      {/* C20 — Chunkability */}
      {c20 && (
        <div className="bg-card rounded-2xl border border-border p-6">
          <div className="flex items-center gap-2 mb-1">
            <Brain className="size-4 text-orange-500" />
            <h3 className="text-sm font-bold text-foreground">{t('c20Title')}</h3>
            <span className="ml-auto text-xs text-muted-foreground">{t('checkNo', { n: 20 })}</span>
          </div>
          <p className="text-xs text-muted-foreground mb-5 leading-relaxed">
            {t('c20Desc')}
          </p>
          <div className="space-y-3 mb-5">
            {c20.optimalChunkRatio !== undefined && (
              <MetricBar label={t('optimalChunkRatio')} value={c20.optimalChunkRatio * 100} color="auto" />
            )}
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {c20.totalChunks !== undefined && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-muted/50 text-muted-foreground border-border">
                {t('contentChunks', { n: c20.totalChunks })}
              </span>
            )}
            {c20.avgChunkLength !== undefined && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-muted/50 text-muted-foreground border-border">
                {t('avgWords', { n: Math.round(c20.avgChunkLength) })}
              </span>
            )}
            {c20.hasFaqStyle && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/60">
                {t('faqStyle')}
              </span>
            )}
          </div>
          {(c20.chunkAnalysis?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-2">{t('topChunks')}</p>
              <div className="space-y-2">
                {c20.chunkAnalysis!.slice(0, 4).map((ch, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground flex-1 truncate">{ch.heading || t('section', { i: i + 1 })}</span>
                    <div className="flex gap-1">
                      {ch.isAnswerFirst && <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 px-1 rounded">{t('answerFirst')}</span>}
                      {ch.isSelfContained && <span className="text-[10px] bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 px-1 rounded">{t('selfContained')}</span>}
                    </div>
                    <span className={`text-xs font-bold w-8 text-right ${ch.extractabilityScore >= 60 ? 'text-emerald-600 dark:text-emerald-300' : ch.extractabilityScore >= 30 ? 'text-amber-600 dark:text-amber-300' : 'text-red-500'}`}>
                      {Math.round(ch.extractabilityScore)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
