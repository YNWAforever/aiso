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
    checks: [
      { key: 'c1_robots', status: 'fail', bucket: 'core' },
      { key: 'c2_llms_txt', status: 'pass', bucket: 'core' },
      { key: 'c3_bot_access', status: 'warn', bucket: 'core' },
    ],
    issues: [{ key: 'c1_robots', status: 'fail', title: 'Review crawler rules', nextStep: 'Check the intended crawler policies.' }],
  },
  pulse: {
    state: 'recorded',
    week: '2026-11-10',
    answers: 6,
    brandMentions: 3,
    brandShare: 50,
    platforms: [{ key: 'gpt-4o', answers: 3, mentions: 2, share: 66.7 }],
    prompts: [{ question: 'What should I eat?', answers: 6, brandMentions: 3 }],
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
    expect(html).toContain('data-testid="check-heatmap"')
    expect(html).toContain('Review crawler rules')
    expect(html).toContain('Pulse baseline')
    expect(html).toContain('ChatGPT')
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
