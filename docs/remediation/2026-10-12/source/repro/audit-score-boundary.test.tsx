import { expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { assignGrade, calculateGeoScore, calculateScore } from '@/lib/scoring'
import type { ScanResults } from '@/lib/types'

const intl = vi.hoisted(() => ({ locale: 'en' }))
vi.mock('next-intl', () => ({ useLocale: () => intl.locale }))
import { ScoreReveal } from '@/components/result/ScoreReveal'

// Audit acceptance reproducer: intentionally RED on PR92 03c7b806.
// All source data is synthetic; there is no HTTP, database or provider call.
it.each(['en', 'zh-HK'])('does not round a stored D-grade score up to the C threshold (%s)', locale => {
  intl.locale = locale
  const pass = { status: 'pass', message: 'fixture' } as const
  const warn = { status: 'warn', message: 'fixture' } as const
  const unavailable = { status: 'fail', message: 'fixture_unavailable' } as const
  const results = {
    c1_robots: pass, c2_llms_txt: pass, c3_bot_access: pass, c4_structured_data: pass,
    c6_llms_full_txt: pass, c9_meta_desc: pass,
    c17_citation_density: unavailable, c18_factual_density: warn,
    c19_topical_authority: warn, c20_chunkability: pass,
  } as unknown as ScanResults
  const score = Math.round((calculateScore(results) + calculateGeoScore(results)) * 100) / 100
  expect(score).toBe(59.97)
  expect(assignGrade(score)).toBe('D')
  const html = renderToStaticMarkup(<ScoreReveal score={score} grade={assignGrade(score)} domain="example.invalid" />)
  const renderedScore = />(\d+(?:\.\d+)?)\/100</.exec(html)?.[1]
  expect(renderedScore).toBe('59.97')
})
