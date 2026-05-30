'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Zap, ChevronRight } from 'lucide-react'
import { ScoreReveal }      from './ScoreReveal'
import { TopIssueCard }     from './TopIssueCard'
import { EmailCaptureGate } from './EmailCaptureGate'
import { LockedPreview }    from './LockedPreview'
import { DeepGeoSection }   from './DeepGeoSection'
import { ExpandableCheckItem } from '@/components/ExpandableCheckItem'
import { CHECK_EXPLANATIONS }  from '@/lib/checkExplanations'
import type { Scan, CheckResult, ScanResults } from '@/lib/types'

/* ── Check key lists ─────────────────────────────────────────── */
const CORE_KEYS = ['c1_robots','c2_llms_txt','c3_bot_access','c4_structured_data','c5_extractability'] as const
const EXT_KEYS  = ['c6_llms_full_txt','c7_mcp_card','c8_sitemap','c9_meta_desc','c10_headings','c11_faq','c12_canonical','c13_render','c14_internal_links','c15_entity','c16_freshness'] as const
const GEO_KEYS  = ['c17_citation_density','c18_factual_density','c19_topical_authority','c20_chunkability'] as const

const CHECK_LABELS: Record<string, string> = {
  c1_robots:            'robots.txt for AI crawlers',
  c2_llms_txt:          'llms.txt present',
  c3_bot_access:        'AI bot accessibility',
  c4_structured_data:   'Structured data (JSON-LD)',
  c5_extractability:    'Content extractability',
  c6_llms_full_txt:     'llms-full.txt',
  c7_mcp_card:          'MCP server card',
  c8_sitemap:           'XML sitemap',
  c9_meta_desc:         'Meta descriptions',
  c10_headings:         'Heading structure',
  c11_faq:              'FAQ schema',
  c12_canonical:        'Canonical tags',
  c13_render:           'Server-side rendering',
  c14_internal_links:   'Internal link graph',
  c15_entity:           'Entity signals',
  c16_freshness:        'Content freshness',
  c17_citation_density: 'Citation density & authority',
  c18_factual_density:  'Factual density',
  c19_topical_authority:'Topical authority',
  c20_chunkability:     'AI chunkability',
}

/* ── Helpers ────────────────────────────────────────────────── */
function getResult(results: Record<string, unknown>, key: string): CheckResult | undefined {
  const v = results[key]
  if (v && typeof v === 'object' && 'status' in (v as object)) return v as CheckResult
  return undefined
}

function countStatuses(results: Record<string, unknown>) {
  const allKeys = [...CORE_KEYS, ...EXT_KEYS, ...GEO_KEYS]
  let pass = 0, warn = 0, fail = 0
  for (const k of allKeys) {
    const r = getResult(results, k)
    if (!r) continue
    if (r.status === 'pass') pass++
    else if (r.status === 'warn') warn++
    else fail++
  }
  return { pass, warn, fail, total: pass + warn + fail }
}

/* ── Section: check list ─────────────────────────────────────── */
function CheckSection({ title, subtitle, keys, results }: {
  title: string; subtitle?: string; keys: readonly string[]; results: Record<string, unknown>
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-6">
      <p className="text-xs font-bold text-slate-500 tracking-widest mb-1">{title}</p>
      {subtitle && <p className="text-xs text-slate-400 mb-4">{subtitle}</p>}
      {!subtitle && <div className="mb-4" />}
      {keys.map(key => {
        const r = getResult(results, key)
        if (!r) return null
        return (
          <ExpandableCheckItem
            key={key}
            label={CHECK_LABELS[key] ?? key}
            result={r}
            message={r.message}
            explanation={CHECK_EXPLANATIONS[key]}
          />
        )
      })}
    </div>
  )
}

/* ── Main component ──────────────────────────────────────────── */
interface Props { scan: Scan; lang: string }

export function ResultClient({ scan, lang }: Props) {
  const [phase, setPhase] = useState<'locked' | 'unlocked'>('locked')

  const r = scan.results as Record<string, unknown>
  const { pass, warn, fail, total } = countStatuses(r)

  // GEO rich data
  type C17 = { qualityScore?: number; authorityBreakdown?: Record<string, number>; citationsPerThousandWords?: number; totalLinks?: number; externalLinks?: number }
  type C18 = { qualityScore?: number; numberDensity?: number; namedEntityDensity?: number; dateReferences?: number; hasComparativeData?: boolean; hasTimeSeriesData?: boolean; uniquenessScore?: number }
  type C19 = { topicalCoverageScore?: number; totalClusters?: number; hasOrphanPages?: number; detectedClusters?: { topic: string; completenessScore: number }[] }
  type C20 = { avgChunkLength?: number; optimalChunkRatio?: number; totalChunks?: number; hasFaqStyle?: boolean; chunkAnalysis?: { heading: string; extractabilityScore: number; isAnswerFirst?: boolean; isSelfContained?: boolean }[] }

  const c17 = (r['c17_citation_density_data'] ?? r['c17']) as C17 | undefined
  const c18 = (r['c18_factual_density_data']  ?? r['c18']) as C18 | undefined
  const c19 = (r['c19_topical_authority_data'] ?? r['c19']) as C19 | undefined
  const c20 = (r['c20_chunkability_data']      ?? r['c20']) as C20 | undefined

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Nav */}
      <nav className="bg-white border-b border-slate-200 px-6 py-3 flex justify-between items-center sticky top-0 z-50">
        <Link href={`/${lang}`} className="flex items-center gap-2">
          <div className="size-6 rounded-md bg-primary flex items-center justify-center">
            <Zap className="size-3.5 text-primary-foreground" />
          </div>
          <span className="font-black text-slate-900 text-sm">
            Fimmick <span className="text-primary">AISO</span>
          </span>
        </Link>
        <div className="flex items-center gap-3">
          <Link
            href={`/${lang}/pricing`}
            className="text-sm font-semibold bg-primary text-primary-foreground px-4 py-1.5 rounded-lg hover:bg-primary/90 transition"
          >
            Get full access
          </Link>
        </div>
      </nav>

      <main className="max-w-2xl mx-auto px-4 py-10 space-y-5">

        {/* 1. Score reveal */}
        <ScoreReveal
          score={scan.score}
          grade={scan.grade ?? 'F'}
          domain={scan.domain}
          industry={scan.industry}
          region={scan.region}
        />

        {/* 2. Summary pills */}
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-slate-400">{total} checks scanned</span>
          <span className="ml-auto flex gap-2">
            {pass > 0 && <span className="bg-emerald-100 text-emerald-700 font-semibold px-2.5 py-1 rounded-full">✅ {pass} passing</span>}
            {warn > 0 && <span className="bg-amber-100  text-amber-700  font-semibold px-2.5 py-1 rounded-full">⚠️ {warn} warnings</span>}
            {fail > 0 && <span className="bg-red-100    text-red-700    font-semibold px-2.5 py-1 rounded-full">❌ {fail} failing</span>}
          </span>
        </div>

        {/* 3. #1 Issue card */}
        <TopIssueCard results={scan.results as ScanResults & Record<string, unknown>} failCount={fail + warn} />

        {/* 4. Locked preview or full results */}
        {phase === 'locked' ? (
          <>
            <LockedPreview checkCount={total} />
            <EmailCaptureGate scanId={scan.id} onUnlocked={() => setPhase('unlocked')} />
          </>
        ) : (
          <>
            {/* Full check breakdown */}
            <CheckSection title="CORE CHECKS" keys={CORE_KEYS} results={r} />
            <CheckSection
              title="EXTENDED CHECKS"
              subtitle="Additional signals that strengthen your AI visibility"
              keys={EXT_KEYS}
              results={r}
            />
            <CheckSection
              title="GEO CHECKS"
              subtitle="Generative Engine Optimisation — content quality for AI citation"
              keys={GEO_KEYS}
              results={r}
            />

            {/* Deep GEO section */}
            <DeepGeoSection c17={c17} c18={c18} c19={c19} c20={c20} />

            {/* Conversion CTA (Fix Pack gated behind signup) */}
            <div className="bg-slate-900 rounded-2xl p-8 text-center">
              <p className="text-3xl mb-3">🛠</p>
              <h2 className="text-white font-black text-xl mb-2">
                Fix your {fail + warn} issue{fail + warn !== 1 ? 's' : ''} — automatically
              </h2>
              <p className="text-slate-400 text-sm mb-6 max-w-sm mx-auto">
                Sign up to generate your personalised Fix Pack: llms.txt, robots.txt patch, and FAQ schema — ready to deploy.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link
                  href={`/${lang}/auth/login`}
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-semibold px-6 py-3 rounded-xl text-sm hover:bg-primary/90 transition"
                >
                  Get my Fix Pack <ChevronRight className="size-4" />
                </Link>
                <Link
                  href={`/${lang}/pricing`}
                  className="inline-flex items-center gap-2 bg-white/10 text-white font-semibold px-6 py-3 rounded-xl text-sm hover:bg-white/20 transition"
                >
                  See pricing
                </Link>
              </div>
              <p className="mt-5">
                <Link href={`/${lang}/auth/login`} className="text-slate-500 text-xs hover:text-slate-300 transition">
                  Already have an account? Sign in
                </Link>
              </p>
            </div>
          </>
        )}

        {/* Scan another */}
        <div className="text-center pb-4">
          <Link href={`/${lang}`} className="text-sm text-slate-400 hover:text-slate-700 transition underline underline-offset-2">
            ← Scan another URL
          </Link>
        </div>
      </main>
    </div>
  )
}
