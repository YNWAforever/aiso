'use client'
import { Brain, Link2, TrendingUp, Layers } from 'lucide-react'
import { useLocale } from 'next-intl'

const COPY_EN = {
  sectionTitle: 'Deep GEO Analysis',
  unlocked: 'Unlocked',
  checkNo: (n: number) => `Check #${n}`,
  // C17
  c17Title: 'Citation Density & Authority',
  c17Desc: 'AI models trust sources that cite trustworthy references. We scored every external link on your page through our 5-layer Authority Engine.',
  overallQuality: 'Overall quality score',
  citationsPer1k: 'Citations per 1,000 words',
  authorityBreakdown: 'Citation authority breakdown',
  tierNote: 'Tier 1 = academic, government & major publications. AI citations weight Tier 1 sources most heavily.',
  tierOther: 'Other',
  totalLinks: (n: number) => <><strong className="text-slate-700">{n}</strong> total links</>,
  externalLinks: (n: number) => <><strong className="text-slate-700">{n}</strong> external</>,
  // C18
  c18Title: 'Factual Density',
  c18Desc: 'AI models prefer citing content dense with specific facts — statistics, dates, named entities, and comparisons. Vague content rarely gets cited.',
  numberDensity: 'Number/stat density',
  entityDensity: 'Named entity density',
  uniqueness: 'Content uniqueness',
  dateRefs: (n: number) => `${n} date references`,
  comparativeData: 'Comparative data',
  timeSeriesData: 'Time-series data',
  // C19
  c19Title: 'Topical Authority',
  c19Desc: 'AI models favour sites that comprehensively cover a topic area. Topic clusters — a pillar page + supporting articles — signal deep expertise.',
  coverageScore: 'Topical coverage score',
  clustersDetected: (n: number) => `${n} topic cluster${n !== 1 ? 's' : ''} detected`,
  orphanPages: (n: number) => `⚠ ${n} orphan page${n > 1 ? 's' : ''}`,
  detectedClusters: 'Detected clusters',
  // C20
  c20Title: 'AI Chunkability',
  c20Desc: "AI models extract content in self-contained 'chunks' to cite. This measures how well your content is structured for that extraction.",
  optimalChunkRatio: 'Optimal chunk ratio',
  contentChunks: (n: number) => `${n} content chunks`,
  avgWords: (n: number) => `Avg ${n} words/chunk`,
  faqStyle: '✓ FAQ-style structure detected',
  topChunks: 'Top chunks by extractability',
  answerFirst: 'Answer-first',
  selfContained: 'Self-contained',
  section: (i: number) => `Section ${i}`,
}

const COPY_ZH_HK: typeof COPY_EN = {
  sectionTitle: '深度 GEO 分析',
  unlocked: '已解鎖',
  checkNo: (n: number) => `檢查 #${n}`,
  // C17
  c17Title: '引用密度及權威度',
  c17Desc: 'AI 模型信任引用可靠來源的網站。我們以 5 層權威引擎為你頁面上的每條對外連結評分。',
  overallQuality: '整體質素分數',
  citationsPer1k: '每 1,000 字引用數',
  authorityBreakdown: '引用權威分佈',
  tierNote: 'Tier 1 = 學術、政府及主要刊物。AI 引用時最重視 Tier 1 來源。',
  tierOther: '其他',
  totalLinks: (n: number) => <>連結總數 <strong className="text-slate-700">{n}</strong></>,
  externalLinks: (n: number) => <>對外連結 <strong className="text-slate-700">{n}</strong></>,
  // C18
  c18Title: '事實密度',
  c18Desc: 'AI 模型偏好引用充滿具體事實的內容——統計數字、日期、具名實體和比較。空泛的內容鮮少被引用。',
  numberDensity: '數字／統計密度',
  entityDensity: '具名實體密度',
  uniqueness: '內容獨特性',
  dateRefs: (n: number) => `${n} 個日期參照`,
  comparativeData: '比較數據',
  timeSeriesData: '時間序列數據',
  // C19
  c19Title: '主題權威',
  c19Desc: 'AI 模型偏好全面覆蓋某個主題範疇的網站。主題群組——支柱頁面 + 支援文章——是深厚專業的訊號。',
  coverageScore: '主題覆蓋分數',
  clustersDetected: (n: number) => `偵測到 ${n} 個主題群組`,
  orphanPages: (n: number) => `⚠ ${n} 個孤立頁面`,
  detectedClusters: '偵測到的群組',
  // C20
  c20Title: 'AI 分塊能力',
  c20Desc: 'AI 模型以自成一體的「塊」提取內容作引用。這項指標衡量你的內容結構有多適合這種提取方式。',
  optimalChunkRatio: '理想分塊比例',
  contentChunks: (n: number) => `${n} 個內容分塊`,
  avgWords: (n: number) => `平均每塊 ${n} 字`,
  faqStyle: '✓ 偵測到 FAQ 式結構',
  topChunks: '可提取度最高的分塊',
  answerFirst: '答案先行',
  selfContained: '自成一體',
  section: (i: number) => `第 ${i} 節`,
}

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

interface TierBadgeProps { tier: string; count: number; otherLabel?: string }
function TierBadge({ tier, count, otherLabel }: TierBadgeProps) {
  const colors: Record<string, string> = {
    tier1: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    tier2: 'bg-blue-100 text-blue-700 border-blue-200',
    tier3: 'bg-slate-100 text-slate-600 border-slate-200',
    other: 'bg-orange-50 text-orange-600 border-orange-200',
  }
  const labels: Record<string, string> = { tier1: 'Tier 1', tier2: 'Tier 2', tier3: 'Tier 3', other: otherLabel ?? 'Other' }
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
  const locale = useLocale()
  const c = locale === 'zh-HK' ? COPY_ZH_HK : COPY_EN
  if (!c17 && !c18 && !c19 && !c20) return null

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Brain className="size-4 text-violet-500" />
        <h2 className="text-sm font-black text-slate-900 tracking-widest uppercase">{c.sectionTitle}</h2>
        <span className="text-xs bg-violet-100 text-violet-700 font-bold px-2 py-0.5 rounded-full">{c.unlocked}</span>
      </div>

      {/* C17 — Citation Density */}
      {c17 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-1">
            <Link2 className="size-4 text-blue-500" />
            <h3 className="text-sm font-bold text-slate-900">{c.c17Title}</h3>
            <span className="ml-auto text-xs text-slate-400">{c.checkNo(17)}</span>
          </div>
          <p className="text-xs text-slate-500 mb-5 leading-relaxed">
            {c.c17Desc}
          </p>
          <div className="space-y-3 mb-5">
            {c17.qualityScore !== undefined && (
              <MetricBar label={c.overallQuality} value={c17.qualityScore} color="auto" />
            )}
            {c17.citationsPerThousandWords !== undefined && (
              <MetricBar label={c.citationsPer1k} value={c17.citationsPerThousandWords} max={10} color="auto" />
            )}
          </div>
          {c17.authorityBreakdown && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-3">{c.authorityBreakdown}</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['tier1','tier2','tier3','other'] as const).map(t => (
                  <TierBadge key={t} tier={t} count={c17.authorityBreakdown?.[t] ?? 0} otherLabel={c.tierOther} />
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-3">
                {c.tierNote}
              </p>
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-slate-100 flex gap-4 text-xs text-slate-500">
            {c17.totalLinks !== undefined && <span>{c.totalLinks(c17.totalLinks)}</span>}
            {c17.externalLinks !== undefined && <span>{c.externalLinks(c17.externalLinks)}</span>}
          </div>
        </div>
      )}

      {/* C18 — Factual Density */}
      {c18 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="size-4 text-emerald-500" />
            <h3 className="text-sm font-bold text-slate-900">{c.c18Title}</h3>
            <span className="ml-auto text-xs text-slate-400">{c.checkNo(18)}</span>
          </div>
          <p className="text-xs text-slate-500 mb-5 leading-relaxed">
            {c.c18Desc}
          </p>
          <div className="space-y-3 mb-5">
            {c18.qualityScore !== undefined && (
              <MetricBar label={c.overallQuality} value={c18.qualityScore} color="auto" />
            )}
            {c18.numberDensity !== undefined && (
              <MetricBar label={c.numberDensity} value={c18.numberDensity} max={10} color="auto" />
            )}
            {c18.namedEntityDensity !== undefined && (
              <MetricBar label={c.entityDensity} value={c18.namedEntityDensity} max={10} color="auto" />
            )}
            {c18.uniquenessScore !== undefined && (
              <MetricBar label={c.uniqueness} value={c18.uniquenessScore} color="auto" />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {c18.dateReferences !== undefined && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${(c18.dateReferences ?? 0) > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
                {c.dateRefs(c18.dateReferences)}
              </span>
            )}
            {c18.hasComparativeData !== undefined && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${c18.hasComparativeData ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                {c18.hasComparativeData ? '✓' : '✗'} {c.comparativeData}
              </span>
            )}
            {c18.hasTimeSeriesData !== undefined && (
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${c18.hasTimeSeriesData ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
                {c18.hasTimeSeriesData ? '✓' : '✗'} {c.timeSeriesData}
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
            <h3 className="text-sm font-bold text-slate-900">{c.c19Title}</h3>
            <span className="ml-auto text-xs text-slate-400">{c.checkNo(19)}</span>
          </div>
          <p className="text-xs text-slate-500 mb-5 leading-relaxed">
            {c.c19Desc}
          </p>
          <div className="space-y-3 mb-5">
            {c19.topicalCoverageScore !== undefined && (
              <MetricBar label={c.coverageScore} value={c19.topicalCoverageScore} color="auto" />
            )}
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            <span className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${(c19.totalClusters ?? 0) > 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-600 border-red-200'}`}>
              {c.clustersDetected(c19.totalClusters ?? 0)}
            </span>
            {(c19.hasOrphanPages ?? 0) > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-amber-50 text-amber-700 border-amber-200">
                {c.orphanPages(c19.hasOrphanPages ?? 0)}
              </span>
            )}
          </div>
          {(c19.detectedClusters?.length ?? 0) > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 mb-2">{c.detectedClusters}</p>
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
            <h3 className="text-sm font-bold text-slate-900">{c.c20Title}</h3>
            <span className="ml-auto text-xs text-slate-400">{c.checkNo(20)}</span>
          </div>
          <p className="text-xs text-slate-500 mb-5 leading-relaxed">
            {c.c20Desc}
          </p>
          <div className="space-y-3 mb-5">
            {c20.optimalChunkRatio !== undefined && (
              <MetricBar label={c.optimalChunkRatio} value={c20.optimalChunkRatio * 100} color="auto" />
            )}
          </div>
          <div className="flex flex-wrap gap-2 mb-4">
            {c20.totalChunks !== undefined && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-slate-50 text-slate-600 border-slate-200">
                {c.contentChunks(c20.totalChunks)}
              </span>
            )}
            {c20.avgChunkLength !== undefined && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-slate-50 text-slate-600 border-slate-200">
                {c.avgWords(Math.round(c20.avgChunkLength))}
              </span>
            )}
            {c20.hasFaqStyle && (
              <span className="text-xs px-2.5 py-1 rounded-full font-semibold border bg-emerald-50 text-emerald-700 border-emerald-200">
                {c.faqStyle}
              </span>
            )}
          </div>
          {(c20.chunkAnalysis?.length ?? 0) > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2">{c.topChunks}</p>
              <div className="space-y-2">
                {c20.chunkAnalysis!.slice(0, 4).map((ch, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-xs text-slate-600 flex-1 truncate">{ch.heading || c.section(i + 1)}</span>
                    <div className="flex gap-1">
                      {ch.isAnswerFirst && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded">{c.answerFirst}</span>}
                      {ch.isSelfContained && <span className="text-[10px] bg-blue-100 text-blue-700 px-1 rounded">{c.selfContained}</span>}
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
