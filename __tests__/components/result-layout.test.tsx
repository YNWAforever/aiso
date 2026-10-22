import { describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '../helpers/intl'
import { ResultClient } from '@/components/result/ResultClient'
import { ScoreReveal, isImprovement } from '@/components/result/ScoreReveal'
import { buildPublicResultSummary } from '@/lib/result-access'
import { buildScanEvidence } from '@/lib/scan-evidence'
import { CORE_PTS, GEO_PTS } from '@/lib/scoring'
import type { Scan } from '@/lib/types'

vi.mock('@/components/result/ClaimScanOnReturn', () => ({ ClaimScanOnReturn: () => null }))
vi.mock('@/components/result/AccountUnlockCard', () => ({ AccountUnlockCard: () => <div data-testid="save-report-cta" /> }))
vi.mock('@/lib/auth-client', () => ({ authClient: {}, buildAuthCompleteUrl: vi.fn() }))

const VERDICTS = {
  c1_robots: 'fail', c2_llms_txt: 'fail', c3_bot_access: 'pass', c4_structured_data: 'warn', c5_extractability: 'pass',
  c19_topical_authority: 'fail', c20_chunkability: 'pass',
} as const

function scan(owned: boolean): Scan {
  const results: Record<string, unknown> = {
    evidence: buildScanEvidence({ requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com', industry: null, region: null, sitemapSource: 'fetched',
      checks: Object.fromEntries(Object.entries(VERDICTS).map(([key, assessment]) => [key, { assessment, collection: 'complete' }])),
      observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: { origin: 'https://example.com' } }] }),
  }
  for (const [key, status] of Object.entries(VERDICTS)) results[key] = { status, message: `SENTINEL_${key}`, details: 'SENTINEL_DETAIL' }
  return { id: 'layout', url: 'https://example.com', domain: 'example.com', score: 42.5, grade: 'F', industry: null, region: null,
    account_id: owned ? 'account-1' : null, created_at: '2026-10-20T00:00:00Z', results: results as Scan['results'] }
}

function render(owned: boolean, locale = 'en') {
  const row = scan(owned)
  return renderWithIntl(<ResultClient lang={locale} summary={buildPublicResultSummary(row)} fullScan={owned ? row : undefined} />, locale)
}

describe('result page layout', () => {
  it('shows score, potential, top fixes, gauges, heatmap and list in that order', () => {
    const html = render(false)
    const order = ['data-testid="score-reveal"', 'data-testid="potential-score-bar"', 'data-testid="result-top-issue"', 'pillars-title', 'data-testid="check-heatmap"', 'list-title']
    const positions = order.map(marker => html.indexOf(marker))
    expect(positions.every(p => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('lists the top three fixes worth the most points first', () => {
    const html = render(false)
    const fixes = html.slice(html.indexOf('data-testid="result-top-issue"'), html.indexOf('pillars-title'))
    // c1, c2 and c19 fail; the c4 warning is fourth. GEO is rescaled over its assessed
    // checks as the scanner scores it: only c19 and c20 have verdicts here.
    const c19 = Math.round(GEO_PTS.c19_topical_authority * 25 / (GEO_PTS.c19_topical_authority + GEO_PTS.c20_chunkability) * 100) / 100
    const points = [CORE_PTS.c1_robots, CORE_PTS.c2_llms_txt, c19].sort((a, b) => b - a)
    expect(fixes.match(/\+\d+(\.\d+)? pts/g)).toEqual(points.map(p => `+${p} pts`))
  })

  it('gives anonymous viewers verdicts only: every tile, no scan messages, and a way to save', () => {
    const html = render(false)
    expect(html.match(/data-testid="check-heatmap"/g)).toHaveLength(1)
    expect(html).not.toContain('full-check-breakdown')
    expect(html).not.toContain('SENTINEL_')
    expect(html).toContain('data-testid="save-result"')
    expect(html).toContain('id="save"')
    expect(html).toContain('Estimated impact:')
  })

  it('gives the owner the full breakdown and the Fix Pack instead of the sign-up card', () => {
    const html = render(true)
    expect(html).toContain('full-check-breakdown')
    expect(html).toContain('data-testid="fix-pack-action"')
    expect(html).not.toContain('data-testid="save-result"')
    expect(html).not.toContain('id="save"')
  })

  it('keeps headings in zh-HK within the text budget', () => {
    const html = render(false, 'zh-HK')
    for (const heading of html.match(/<h2[^>]*>([^<]*)<\/h2>/g) ?? []) {
      const text = heading.replace(/<[^>]+>/g, '')
      expect([...text].length).toBeLessThanOrEqual(14)
    }
  })
})

describe('the one celebration', () => {
  it('fires only when the score went up or the grade improved', () => {
    expect(isImprovement(70, 'B', { score: 65, grade: 'C' })).toBe(true)
    expect(isImprovement(65, 'C', { score: 65, grade: 'C' })).toBe(false)
    expect(isImprovement(60, 'C', { score: 65, grade: 'C' })).toBe(false)
    expect(isImprovement(60, 'C', null)).toBe(false)
  })

  it('marks the score and says so in words, never on a first scan', () => {
    const improved = renderWithIntl(<ScoreReveal score={72} grade="B" domain="example.com" previous={{ score: 64, grade: 'C' }} />)
    expect(improved).toContain('data-improved="true"')
    expect(improved).toContain('result-glow')
    expect(improved).toContain('New grade: B.')
    const first = renderWithIntl(<ScoreReveal score={72} grade="B" domain="example.com" />)
    expect(first).not.toContain('data-improved')
    expect(first).not.toContain('result-glow')
  })
})
