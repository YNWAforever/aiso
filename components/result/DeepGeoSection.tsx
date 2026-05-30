'use client'
import { Brain, Link2, TrendingUp, Layers } from 'lucide-react'

interface MetricBarProps { label: string; value: number; max?: number; color?: string }
function MetricBar({ label, value, max = 100, color = 'bg-primary' }: MetricBarProps) {
  const pct = Math.min(100, (value / max) * 100)
  const barColor = pct >= 60 ? 'bg-emerald-500' : pct >= 30 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-36 shrink-0">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${color === 'auto' ? barColor : color} transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold text-slate-700 w-12 text-right">{Math.round(value)}{max === 100 ? '/100' : ''}</span>
    </div>
  )
}

interface TierBadgeProps { tier: string; count: number }
function TierBadge({ tier, count }: TierBadgeProps) {
  const colors: Record<string, string> = {
    tier1: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    tier2: 'bg-blue-100 text-blue-700 border-blue-200',
    tier3: 'bg-slate-100 text-slate-600 border-slate-200',
    other: 'bg-orange-50 text-orange-600 border-orange-200',
  }
  const labels: Record<string, string> = { tier1: 'Tier 1', tier2: 'Tier 2', tier3: 'Tier 3', other: 'Other' }
  return (
    <div className={`flex items-center justify-between px-3 py-2 rounded-lg border text-xs font-semibold ${colors[tier] ?? colors.other}`}>
      <span>{labels[tier] ?? tier}</span>
      <span className="font-black">{count}</span>
    </div>
  )
}

type C17Data = { qualityScore?: number; authorityBreakdown?: Record<string, number>; citationsPerThousandWords?: number; totalLinks?: number; externalLinks?: number }
type C18Data = { qualityScore?: number; numberDensity?: number; namedEntityDensity?: number; dateReferences?: number; hasComparativeData?: boolean; hasTimeSeriesData?: boolean; uniquenessScore?: number }
type C19Data = { topicalCoverageScore?: number; totalClusters?: number; hasOrphanPages?: number; detectedClusters?: { topic: string; completenessScore: number }[] }
type C20Data = { avgChunkLength?: number; optimalChunkRatio?: number; totalChunks?: number; hasFaqStyle?: boolean; chunkAnalysis?: { heading: string; extractabilityScore: number; isAnswerFirst?: boolean; isSelfContained?: boolean }[] }

interface Props {
  c17?: C17Data
  c18?: C18Data
  c19?: C19Data
  c20?: C20Data
}

export function DeepGeoSection({ c17, c18, c19, c20 }: Props) {
  if (!c17 && !c18 && !c19 && !c20) return null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Brain className="size-4 text-violet-500" />
        <h2 className="text-sm font-black text-slate-900 tracking-widest uppercase">Deep GEO Analysis</h2>
        <span className="text-xs bg-violet-100 text-violet-700 font-bold px-2 py-0.5 rounded-full">Unlocked</span>
      </div>

      {/* C17 — Citation Density */}
      {c17 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-1">
            <Link2 className="size-4 text-blue-500" />
            <h3 className="text-sm font-bold text-slate-900">Citation Density & Authority</h3>
            <span className="ml-auto text-xs text-slate-400">Check #17</span>
          </div>
          <p className="text-xs text-slate-500 mb-5 leading-relaxed">
            AI models trust sources that cite trustworthy references. We scored every external link on your page through our 5-layer Authority Engine.
          </p>
          <div className="space-y-3 mb-5">
            {c17.qualityScore !== undefined && (
              <MetricBar label="Overall quality score" value={c17.qualityScore} color="auto" />
            )}
            {c17.citationsPerThousandWords !== undefined && (
              <MetricBar label="Citations per 1,000 words" value={c17.citationsPerThousandWords} max={10} color="auto" />
            )}
          </div>
          {c17.authorityBreakdown && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-3">Citation authority breakdown</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['tier1','tier2','tier3','other'] as const).map(t => (
                  <TierBadge key={t} tier={t} count={c17.authorityBreakdown?.[t] ?? 0} />
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-3">
                Tier 1 = academic, government & major publications. AI citations weight Tier 1 sources most heavily.
              </p>
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-slate-100 flex gap-4 text-xs text-slate-500">
            {c17.totalLinks !== undefined && <span><strong className="text-slate-700">{c17.totalLinks}</strong> total links</span>}
            {c17.externalLinks !== undefined && <span><strong className="text-slate-700">{c17.externalLinks}</strong> external</span>}
          </div>
        </div>
      )}

      {/* C18 — Factual Density */}
      {c18 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="size-4 text-emerald-500" />
            <h3 className="text-sm font-bold text-slate-900">Factual Density</h3>
            <span className="ml-auto text-xs text-slate-400">Check #18</span>
          </div>
          <p className="text-xs text-slate-500 mb-5 leading-relaxed">
            AI models prefer citing content dense with specific facts — statistics, dates, named entities, and comparisons. Vague content rarely gets cited.
          </p>
          <div className="space-y-3 mb-5">
            {c18.qualityScore !== undefined && (
              <MetricBar label="Overall quality score" value={c18.qualityScore} color="auto" />
            )}
            {c18.numberDensity !== undefined && (
              <MetricBar label="Number/stat density" value={c18.numberDensity} max={10} color="auto" />
            )}
            {c18.namedEntityDensity !== undefined && (
              <MetricBar label="Named entity density" value={c18.namedEntityDensity} max={10} color="auto" />
            )}
            {c18.uniquenessScore !== undefined && (
              <MetricBar label="Content uniqueness" value={c18.uniquenessScore} color="auto" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {c18.dateReferences !== undefined && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${(c18.dateReferences ?? 0) > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                {c18.dateReferences} date references
              </span>
            )}
            {c18.hasComparativeData !== undefined && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${c18.hasComparativeData ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                {c18.hasComparativeData ? '✓' : '✗'} Comparative data
              </span>
            )}
            {c18.hasTimeSeriesData !== undefined && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${c18.hasTimeSeriesData ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                {c18.hasTimeSeriesData ? '✓' : '✗'} Time-series data
              </span>
            )}
          </div>
        </div>
      )}

      {/* C19 — Topical Authority */}
      {c19 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-1">
            <Layers className="size-4 text-violet-500" />
            <h3 className="text-sm font-bold text-slate-900">Topical Authority</h3>
            <span className="ml-auto text-xs text-slate-400">Check #19</span>
          </div>
          <p className="text-xs text-slate-500 mb-5 leading-relaxed">
            AI models favour sites that comprehensively cover a topic area. Topic clusters — a pillar page + supporting articles — signal deep expertise.
          </p>
          <div className="space-y-3 mb-5">
            {c19.topicalCoverageScore !== undefined && (
              <MetricBar label="Topical coverage score" value={c19.topicalCoverageScore} color="auto" />
            )}
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${(c19.totalClusters ?? 0) > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
              {c19.totalClusters ?? 0} topic cluster{(c19.totalClusters ?? 0) !== 1 ? 's' : ''} detected
            </span>
            {(c19.hasOrphanPages ?? 0) > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                ⚠ {c19.hasOrphanPages} orphan page{(c19.hasOrphanPages ?? 0) > 1 ? 's' : ''}
              </span>
            )}
          </div>
          {(c19.detectedClusters?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 mb-2">Detected clusters</p>
              {c19.detectedClusters!.slice(0, 5).map((cl, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-slate-600 flex-1 truncate capitalize">{cl.topic}</span>
                  <div className="w-24 h-1.5 rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${cl.completenessScore >= 60 ? 'bg-emerald-500' : cl.completenessScore >= 30 ? 'bg-amber-400' : 'bg-red-400'}`}
                      style={{ width: `${cl.completenessScore}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-500 w-8 text-right">{Math.round(cl.completenessScore)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* C20 — Chunkability */}
      {c20 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-1">
            <Brain className="size-4 text-orange-500" />
            <h3 className="text-sm font-bold text-slate-900">AI Chunkability</h3>
            <span className="ml-auto text-xs text-slate-400">Check #20</span>
          </div>
          <p className="text-xs text-slate-500 mb-5 leading-relaxed">
            AI models extract content in self-contained 'chunks' to cite. This measures how well your content is structured for that extraction.
          </p>
          <div className="space-y-3 mb-5">
            {c20.optimalChunkRatio !== undefined && (
              <MetricBar label="Optimal chunk ratio" value={c20.optimalChunkRatio * 100} color="auto" />
            )}
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {c20.totalChunks !== undefined && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-slate-50 text-slate-600 border-slate-200">
                {c20.totalChunks} content chunks
              </span>
            )}
            {c20.avgChunkLength !== undefined && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-slate-50 text-slate-600 border-slate-200">
                Avg {Math.round(c20.avgChunkLength)} words/chunk
              </span>
            )}
            {c20.hasFaqStyle && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
                ✓ FAQ-style structure detected
              </span>
            )}
          </div>
          {(c20.chunkAnalysis?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2">Top chunks by extractability</p>
              <div className="space-y-2">
                {c20.chunkAnalysis!.slice(0, 4).map((ch, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-slate-600 flex-1 truncate">{ch.heading || `Section ${i + 1}`}</span>
                    <div className="flex gap-1">
                      {ch.isAnswerFirst && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded">Answer-first</span>}
                      {ch.isSelfContained && <span className="text-[10px] bg-blue-100 text-blue-700 px-1 rounded">Self-contained</span>}
                    </div>
                    <span className={`text-xs font-bold w-8 text-right ${ch.extractabilityScore >= 60 ? 'text-emerald-600' : ch.extractabilityScore >= 30 ? 'text-amber-600' : 'text-red-500'}`}>
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
