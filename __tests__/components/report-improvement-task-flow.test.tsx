import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { ReportImprovementTasks } from '@/components/reports/ReportImprovementTasks'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const finding = {
  checkKey: 'c1_robots' as const,
  title: 'Review crawler access',
  rationale: 'The report recorded a robots check failure for the selected scan.',
  expectedImpact: 'high' as const,
  nextStep: 'Review robots.txt and submit a verified change for later observation.',
  rank: 1,
  source: { kind: 'scan-check' as const, id: '33333333-3333-4333-8333-333333333333', checkKey: 'c1_robots' as const },
  ruleVersion: 'scan-check-gap.v1' as const,
  fingerprint: 'a'.repeat(64),
  targetUrl: 'https://example.test',
  observations: [{
    observedAt: '2026-10-18T09:00:00.000Z',
    provenance: 'validated-fetch' as const,
    collection: 'complete' as const,
    target: { origin: 'https://example.test', pathRedacted: false, queryRedacted: false, fragmentRedacted: false, originNormalized: true },
    httpStatus: 200,
    signals: { mimeType: 'text/plain' },
    check: 'page' as const,
  }],
  reportProvenance: {
    reportId: '11111111-1111-4111-8111-111111111111',
    reportVersionId: '22222222-2222-4222-8222-222222222222',
    reportVersionNumber: 2,
    reportCreatedAt: '2026-10-18T09:02:00.000Z',
    findingKey: 'c1_robots' as const,
    findingTitle: 'Review crawler access',
    findingRationale: 'The report recorded a robots check failure for the selected scan.',
    findingNextStep: 'Review robots.txt and submit a verified change for later observation.',
    expectedImpact: 'high' as const,
    targetOrigin: 'https://example.test',
  },
  existingTask: null,
}

function render(lang: 'en' | 'zh-HK') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={lang} messages={lang === 'en' ? en : zh} timeZone="UTC">
      <ReportImprovementTasks
        clientId="55555555-5555-4555-8555-555555555555"
        brandName="Synthetic brand"
        domain="example.test"
        reportId={finding.reportProvenance.reportId}
        reportVersionId={finding.reportProvenance.reportVersionId}
        reportVersionNumber={2}
        latestVersionNumber={3}
        locale={lang}
        findingsState="ok"
        findings={[finding]}
      />
    </NextIntlClientProvider>,
  )
}

describe('report improvement task entry', () => {
  it.each(['en', 'zh-HK'] as const)('shows the report version, evidence and newer-version warning in %s', lang => {
    const html = render(lang)
    expect(html).toContain('c1_robots')
    expect(html).toContain('https://example.test')
    expect(html).toContain('2026-10-18T09:00:00.000Z')
    expect(html).toContain(lang === 'en' ? 'newer report version is available' : '已有較新報告版本')
    expect(html).toContain(lang === 'en' ? 'does not change the website' : '不會修改網站')
  })

  it('distinguishes empty and unavailable finding states', () => {
    const props = {
      clientId: '55555555-5555-4555-8555-555555555555',
      brandName: 'Synthetic brand',
      domain: 'example.test',
      reportId: finding.reportProvenance.reportId,
      reportVersionId: finding.reportProvenance.reportVersionId,
      reportVersionNumber: 2,
      latestVersionNumber: 3,
      locale: 'en' as const,
      findings: [],
    }
    const empty = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <ReportImprovementTasks {...props} findingsState="empty" />
      </NextIntlClientProvider>,
    )
    const unavailable = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <ReportImprovementTasks {...props} findingsState="unavailable" />
      </NextIntlClientProvider>,
    )
    expect(empty).toContain('No actionable findings')
    expect(unavailable).toContain('Finding evidence is unavailable')
  })
})
