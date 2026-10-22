import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { ResultClient } from '@/components/result/ResultClient'
import { buildPublicResultSummary } from '@/lib/result-access'
import { buildScanEvidence } from '@/lib/scan-evidence'
import type { Scan } from '@/lib/types'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

// The claim flow requires a Next router. Status rendering and translations stay real.
vi.mock('@/components/result/ClaimScanOnReturn', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/result/ClaimScanOnReturn')>(),
  ClaimScanOnReturn: () => null,
}))
vi.mock('@/lib/auth-client', () => ({ authClient: {}, buildAuthCompleteUrl: vi.fn() }))

function results(): Scan['results'] {
  return {
    evidence: buildScanEvidence({
      requestedUrl: 'https://example.com', evaluatedUrl: 'https://example.com',
      industry: 'general_b2c', region: 'HK', sitemapSource: null,
      checks: {},
      observations: [{ target: 'https://example.com', check: 'page', collection: 'complete', provenance: 'validated-fetch', httpStatus: 200 }],
    }),
    c1_robots: { status: 'fail', message: 'robots_not_found' },
    c2_llms_txt: { status: 'fail', message: 'llms_txt_missing' },
    c3_bot_access: { status: 'warn', message: 'bots_partially_blocked' },
    c4_structured_data: { status: 'fail', message: 'schema_missing' },
    c5_extractability: { status: 'warn', message: 'extractability_partial' },
    c17_citation_density: { status: 'fail', message: 'citation_density_fail', details: 'Quality score 0/100' },
    c18_factual_density: { status: 'warn', message: 'factual_density_warn', details: 'Quality score 20.016/100' },
    c18_factual_density_data: { qualityScore: 20.016, uniquenessScore: 15, uniquenessStatus: 'observed' },
    c20_chunkability: { status: 'fail', message: 'chunkability_no_headings' },
  }
}

function render(locale: 'en' | 'zh-HK', checks = results(), owned = true) {
  const scan: Scan = {
    id: 'synthetic-status-badges', url: 'https://example.com', domain: 'example.com',
    score: 14.17, grade: 'F', industry: 'general_b2c', region: 'HK',
    account_id: 'synthetic-account', created_at: '2026-10-16T00:00:00Z', results: checks,
  }
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh} timeZone="UTC">
      <ResultClient lang={locale} summary={buildPublicResultSummary(scan)} fullScan={owned ? scan : undefined} />
    </NextIntlClientProvider>,
  )
}

describe('public result status badges', () => {
  // Returning to the raw message prop must fail these real-render locale tests.
  it.each([
    ['en', 'robots.txt not found', 'Very few citations', 'Moderate factual density', 'No section headings found'],
    ['zh-HK', '找不到 robots.txt', '引用極少', '事實密度一般', '未找到段落標題'],
  ] as const)('localizes stored statuses in %s without changing the scan', (locale, robots, citation, factual, chunk) => {
    const checks = results()
    const before = JSON.stringify(checks)
    const html = render(locale, checks)
    for (const label of [robots, citation, factual, chunk]) expect(html).toContain(label)
    for (const key of ['robots_not_found', 'citation_density_fail', 'factual_density_warn', 'chunkability_no_headings']) {
      expect(html).not.toContain(`>${key}</span>`)
    }
    expect(JSON.stringify(checks)).toBe(before)
  })

  it.each(['en', 'zh-HK'] as const)('keeps an unknown or prototype-named legacy status readable in %s', locale => {
    for (const message of ['legacy_status_unmapped', 'toString']) {
      const checks = results()
      checks.c20_chunkability = { status: 'warn', message }
      expect(render(locale, checks)).toContain(`>${message}</span>`)
    }
  })

  it.each(['en', 'zh-HK'] as const)('retains the unavailable evidence override in %s', locale => {
    const checks = results()
    checks.c18_factual_density = { status: 'fail', message: 'factual_density_unavailable' }
    checks.c18_factual_density_data = { qualityScore: null, uniquenessScore: null, uniquenessStatus: 'unavailable' }
    const html = render(locale, checks)
    expect(html).toContain(locale === 'en' ? 'Unavailable — retry to obtain provider evidence' : '未能取得資料 — 請重試以取得供應商證據')
    expect(html).not.toContain('>factual_density_unavailable</span>')
  })

  it.each(['en', 'zh-HK'] as const)('keeps detailed status badges out of the anonymous teaser in %s', locale => {
    const html = render(locale, results(), false)
    expect(html).not.toContain('full-check-breakdown')
    expect(html).not.toContain('>citation_density_fail</span>')
    expect(html).not.toContain('>Very few citations</span>')
    expect(html).not.toContain('>引用極少</span>')
  })
})
