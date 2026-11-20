import { createElement } from 'react'
import { expect, it, vi } from 'vitest'
import { ResultClient } from '@/components/result/ResultClient'
import { buildPublicResultSummary } from '@/lib/result-access'
import { buildScanEvidence } from '@/lib/scan-evidence'
import type { Scan } from '@/lib/types'
import { renderWithIntl } from '@/__tests__/helpers/intl'

vi.mock('@/components/result/ClaimScanOnReturn', () => ({ ClaimScanOnReturn: () => null }))
vi.mock('@/components/result/AccountUnlockCard', () => ({ AccountUnlockCard: () => null }))

const scan = {
  id: 'scan-1', domain: 'example.com', score: 42.5, grade: 'F', industry: null, region: null,
  url: 'https://example.com', created_at: '2026-11-18T08:00:00.000Z',
  results: {
    evidence: buildScanEvidence({ requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com',
      industry: null, region: null, sitemapSource: 'fetched',
      checks: { c1_robots: { assessment: 'pass', collection: 'complete' } },
      observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: { origin: 'https://example.com' } }] }),
    c1_robots: { status: 'pass', message: 'robots_ai_allowed', collectorAccess: [
      { crawler: 'OAI-SearchBot', role: 'search', policy: 'allowed', probe: 'not_measured' },
    ] },
  },
} as Scan

it.each([
  ['en', 'Recorded crawler rules', 'Consumer AI exposure'],
  ['zh-HK', '已記錄的爬蟲規則', '消費者 AI 曝光'],
] as const)('hides exposure placeholders publicly and keeps evidence available to the owner in %s', (lang, crawlerLabel, exposureLabel) => {
  const summary = buildPublicResultSummary(scan)
  const publicHtml = renderWithIntl(createElement(ResultClient, { lang, summary }), lang)
  expect(publicHtml).not.toContain(exposureLabel)
  expect(publicHtml).not.toContain('OAI-SearchBot')
  expect(JSON.stringify(summary)).not.toContain('OAI-SearchBot')
  const ownerHtml = renderWithIntl(createElement(ResultClient, { lang, summary, fullScan: scan, workspace: { clientId: 'owned-brand', canShare: false } }), lang)
  expect(ownerHtml).toContain(crawlerLabel)
  expect(ownerHtml).toContain('OAI-SearchBot')
  expect(ownerHtml).not.toContain(exposureLabel)
})
