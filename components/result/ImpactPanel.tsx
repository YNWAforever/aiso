'use client'
import { ArrowRight, Clock } from 'lucide-react'
import { useLocale } from 'next-intl'
import type { ImpactReport, PlatformStatus, Effort } from '@/lib/impact'

const STATUS_STYLES: Record<PlatformStatus, { dot: string; label: string; text: string }> = {
  visible: { dot: 'bg-emerald-500', label: 'Visible',  text: 'text-emerald-700' },
  partial: { dot: 'bg-amber-500',   label: 'Partial',  text: 'text-amber-700' },
  blocked: { dot: 'bg-red-500',     label: 'Blocked',  text: 'text-red-700' },
}

const STATUS_LABELS_ZH_HK: Record<PlatformStatus, string> = {
  visible: '可見', partial: '部分可見', blocked: '被封鎖',
}

const EFFORT_STYLES: Record<Effort, { label: string; cls: string }> = {
  minutes: { label: '~10 min',  cls: 'bg-emerald-100 text-emerald-700' },
  hours:   { label: 'hours',    cls: 'bg-blue-100 text-blue-700' },
  days:    { label: 'days+',    cls: 'bg-slate-100 text-slate-600' },
}

const EFFORT_LABELS_ZH_HK: Record<Effort, string> = {
  minutes: '約 10 分鐘', hours: '數小時', days: '數天以上',
}

/* Localized quick-win labels keyed by check key — falls back to English label */
const QUICK_WIN_LABELS_ZH_HK: Record<string, string> = {
  c1_robots: '在 robots.txt 允許 AI 爬蟲',
  c2_llms_txt: '新增 llms.txt 檔案',
  c3_bot_access: '在伺服器層面解除 AI 機械人封鎖',
  c4_structured_data: '加入 JSON-LD 結構化數據',
  c5_extractability: '改善內容可提取度',
  c6_llms_full_txt: '新增 llms-full.txt 檔案',
  c7_mcp_card: '發佈 MCP 伺服器卡片',
  c8_sitemap: '新增 XML sitemap',
  c9_meta_desc: '撰寫 meta description',
  c10_headings: '修復標題結構',
  c11_faq: '加入 FAQ schema',
  c12_canonical: '加入 canonical 標籤',
  c13_render: '內容改用伺服器端渲染',
  c14_internal_links: '加強內部連結',
  c15_entity: '加入實體訊號',
  c16_freshness: '更新內容新鮮度訊號',
  c17_citation_density: '引用更高權威的來源',
  c18_factual_density: '加入統計數字、日期及具名事實',
  c19_topical_authority: '建立主題群組',
  c20_chunkability: '將內容重組為適合 AI 的分塊',
}

const UI_EN = {
  title: 'IMPACT ANALYSIS',
  subtitle: 'What your score means — and what fixing it would gain',
  platformVisibility: 'AI platform visibility',
  aiReadable: 'Content AI can actually use',
  now: 'Now',
  after: 'After fixes',
  pts: (n: number) => `+${n} pts`,
  quickWinsTitle: 'Highest-impact fixes first',
}

const UI_ZH_HK: typeof UI_EN = {
  title: '影響分析',
  subtitle: '你的分數代表甚麼——以及修復後可以得到甚麼',
  platformVisibility: 'AI 平台可見度',
  aiReadable: 'AI 真正能使用的內容',
  now: '現時',
  after: '修復後',
  pts: (n: number) => `+${n} 分`,
  quickWinsTitle: '最高影響的修復優先',
}

interface Props {
  impact: ImpactReport
  score: number
  grade: string
}

/**
 * Unlocked-phase impact breakdown: platform visibility grid,
 * AI-readable gauge, now→after projection, ranked quick wins.
 */
export function ImpactPanel({ impact, score, grade }: Props) {
  const locale = useLocale()
  const isZh = locale === 'zh-HK'
  const ui = isZh ? UI_ZH_HK : UI_EN
  const { platformVisibility, aiReadablePercent, quickWins, projectedScore, projectedGrade } = impact
  const delta = Math.round((projectedScore - score) * 10) / 10
  const topWins = quickWins.slice(0, 6)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-6">
      <div>
        <p className="text-xs font-bold text-slate-500 tracking-widest mb-1">{ui.title}</p>
        <p className="text-xs text-slate-600">{ui.subtitle}</p>
      </div>

      {/* Platform visibility */}
      {platformVisibility.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">{ui.platformVisibility}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {platformVisibility.map(p => {
              const s = STATUS_STYLES[p.status]
              return (
                <div key={p.platform} className="flex items-center gap-2.5 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <span className={`size-2 rounded-full shrink-0 ${s.dot}`} />
                  <span className="text-xs font-semibold text-slate-800 shrink-0">{p.label}</span>
                  <span className={`text-2xs font-bold ml-auto shrink-0 ${s.text}`}>{isZh ? STATUS_LABELS_ZH_HK[p.status] : s.label}</span>
                </div>
              )
            })}
          </div>
          {platformVisibility.some(p => p.status !== 'visible') && (
            <p className="text-2xs text-slate-600 mt-1.5">
              {platformVisibility.find(p => p.status === 'blocked')?.reason
                ?? platformVisibility.find(p => p.status === 'partial')?.reason}
            </p>
          )}
        </div>
      )}

      {/* AI-readable gauge */}
      {aiReadablePercent !== null && (
        <div>
          <div className="flex items-baseline justify-between mb-1.5">
            <p className="text-xs font-semibold text-slate-600">{ui.aiReadable}</p>
            <p className={`text-sm font-black tabular-nums ${
              aiReadablePercent >= 75 ? 'text-emerald-700' : aiReadablePercent >= 50 ? 'text-amber-700' : 'text-red-700'
            }`}>{aiReadablePercent}%</p>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                aiReadablePercent >= 75 ? 'bg-emerald-500' : aiReadablePercent >= 50 ? 'bg-amber-500' : 'bg-red-500'
              }`}
              style={{ width: `${aiReadablePercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Now → After projection */}
      {delta > 0 && (
        <div className="flex items-center justify-center gap-4 rounded-xl bg-slate-50 border border-slate-100 py-4">
          <div className="text-center">
            <p className="text-2xl font-black text-slate-900 tabular-nums leading-none">{score}</p>
            <p className="text-2xs text-slate-600 font-semibold mt-1">{ui.now} · {grade}</p>
          </div>
          <ArrowRight className="size-4 text-slate-300" />
          <div className="text-center">
            <p className="text-2xl font-black text-emerald-700 tabular-nums leading-none">{projectedScore}</p>
            <p className="text-2xs text-emerald-700 font-semibold mt-1">{ui.after} · {projectedGrade}</p>
          </div>
          <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">{ui.pts(delta)}</span>
        </div>
      )}

      {/* Quick wins */}
      {topWins.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">{ui.quickWinsTitle}</p>
          <div className="space-y-1.5">
            {topWins.map(w => (
              <a
                key={w.key}
                href={`#${w.key}`}
                className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2.5 hover:bg-slate-50 transition group"
              >
                <span className="text-xs font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full shrink-0 tabular-nums">
                  {ui.pts(w.pointsGain)}
                </span>
                <span className="text-xs text-slate-700 font-medium min-w-0 truncate group-hover:text-slate-900">
                  {isZh ? (QUICK_WIN_LABELS_ZH_HK[w.key] ?? w.label) : w.label}
                </span>
                <span className={`ml-auto shrink-0 inline-flex items-center gap-1 text-2xs font-semibold px-1.5 py-0.5 rounded ${EFFORT_STYLES[w.effort].cls}`}>
                  <Clock className="size-2.5" />
                  {isZh ? EFFORT_LABELS_ZH_HK[w.effort] : EFFORT_STYLES[w.effort].label}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
