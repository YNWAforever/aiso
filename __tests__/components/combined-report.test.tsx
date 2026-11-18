import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { CombinedReport } from '@/components/reports/CombinedReport'
import type { CombinedReportData } from '@/lib/reports/combined'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const report: CombinedReportData = {
  client: { name: 'Sino Group', domain: 'sino.com' },
  branding: null,
  activeQuestions: 4,
  generatedAt: '2026-11-18T02:00:00.000Z',
  scan: {
    state: 'recorded',
    scanId: 'scan-1',
    score: 48,
    grade: 'F',
    scannedAt: '2026-11-17T15:03:59.776Z',
    collectionFailed: false,
    counts: { pass: 2, warn: 1, fail: 1, unknown: 16, notApplicable: 0, total: 20 },
    potentialScore: 52.5,
    buckets: [
      { key: 'core', earned: 20, max: 45 },
      { key: 'extended', earned: 12, max: 30 },
      { key: 'geo', earned: 8, max: 25 },
    ],
    checks: [
      { key: 'c1_robots', status: 'fail', bucket: 'core', weight: 10, finding: 'robots_ai_blocked', action: 'Check the intended crawler policies.' },
      { key: 'c2_llms_txt', status: 'pass', bucket: 'core', weight: 8 },
      { key: 'c3_bot_access', status: 'warn', bucket: 'core', weight: 9, finding: 'bots_partially_blocked', action: 'Review your CDN rules.' },
    ],
    issues: [{ key: 'c1_robots', status: 'fail', title: 'Review crawler rules', nextStep: 'Check the intended crawler policies.', points: 10 }],
    geo: {
      c17: { qualityScore: 10, citationsPerThousandWords: 147.1, totalLinks: 5, externalLinks: 5, authorityBreakdown: { tier1: 0, tier2: 0, tier3: 0, other: 1 } },
      c18: { qualityScore: 21.5, numberDensity: 0, namedEntityDensity: 23.5, dateReferences: 0, uniquenessScore: 15, uniquenessStatus: 'observed', hasComparativeData: false, hasTimeSeriesData: false },
      c19: { topicalCoverageScore: 93, totalClusters: 5, hasOrphanPages: 1 },
      c19Check: { message: 'topical_authority_pass', diagnostic: { collection: 'complete' } },
      c20: { totalChunks: 0, avgChunkLength: 0, optimalChunkRatio: 0, hasFaqStyle: false },
    },
    trustSignals: { version: '2026-10-10.v1', signals: [{ key: 'author', status: 'fail' }, { key: 'https', status: 'pass' }] },
  },
  pulse: {
    state: 'recorded',
    week: '2026-11-10',
    answers: 6,
    brandMentions: 3,
    brandShare: 50,
    change: 4.2,
    platforms: [{ key: 'gpt-4o', answers: 3, mentions: 2, share: 66.7 }],
    prompts: [{ question: 'What should I eat?', answers: 6, brandMentions: 3 }],
    competitors: [{ label: 'Rival', mentions: 2, share: 33.3 }],
  },
}

function render(data: CombinedReportData, locale: 'en' | 'zh-HK' = 'en') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh} timeZone="Asia/Hong_Kong">
      <CombinedReport report={data} clientId="client-1" />
    </NextIntlClientProvider>,
  )
}

describe('CombinedReport', () => {
  it('renders the scan and Pulse sections on one printable report without AISO', () => {
    const html = render(report)
    expect((html.match(/<h1/g) ?? [])).toHaveLength(1)
    expect(html).toContain('Scan + Pulse report')
    expect(html).toContain('Sino Group')
    expect(html).toContain('Website scan')
    expect(html).toContain('Score 48 / 100')
    expect(html).toContain('Score after the three priority fixes: 52.5 / 100')
    expect(html).toContain('data-testid="check-heatmap"')
    expect(html).toContain('Review crawler rules')
    expect(html).toContain('All 20 checks')
    expect(html).toContain('AI bots are blocked')
    expect(html).toContain('GEO detail')
    expect(html).toContain('Citation Density &amp; Authority')
    expect(html).toContain('Trust and E-E-A-T signals')
    expect(html).toContain('Pulse baseline')
    expect(html).toContain('ChatGPT')
    expect(html).toContain('Rival')
    expect(html).toContain('4.2 points vs the previous week')
    expect(html).toContain('What should I eat?')
    expect(html).not.toMatch(/AISO/i)
  })

  it('shows explicit empty states instead of zeros when data is absent', () => {
    const html = render({
      ...report,
      scan: { state: 'none' },
      pulse: { state: 'none' },
      activeQuestions: 0,
    })
    expect(html).toContain('No saved website scan yet.')
    expect(html).toContain('No completed Pulse baseline yet.')
    expect(html).not.toContain('data-testid="check-heatmap"')
    expect(html).not.toContain('Mention rate')
  })

  it('renders in Traditional Chinese without AISO', () => {
    const html = render(report, 'zh-HK')
    expect(html).toContain('掃描 + Pulse 報告')
    expect(html).toContain('網站掃描')
    expect(html).toContain('Pulse 基準')
    expect(html).not.toMatch(/AISO/i)
  })
})
