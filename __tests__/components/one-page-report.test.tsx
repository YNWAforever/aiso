import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { OnePageReport } from '@/components/reports/OnePageReport'
import { CHECK_SLOTS } from '@/lib/result/view-model'
import { buildReportPage, reportFixView } from '@/lib/view-models/report-page'
import type { ClientReportSnapshotV1 } from '@/lib/reports/types'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const snapshot: ClientReportSnapshotV1 = {
  snapshotSchemaVersion: 1,
  locale: 'en',
  branding: { agencyName: 'Acme Agency', logoUrl: null, primaryColor: '#123ABC', contactLabel: null, contactUrl: null, attribution: 'Powered by Fimmick AISO' },
  client: { name: 'Example Client', domain: 'example.com' },
  evidence: { scanDate: '2026-07-21T08:00:00.000Z', evidenceTimestamp: '2026-07-21T08:00:00.000Z' },
  score: { current: 72, grade: 'B', comparisonState: 'comparable', previous: 65, delta: 7, previousScanDate: '2026-07-01T08:00:00.000Z' },
  changes: [{ key: 'c1_robots', label: 'Robots access', kind: 'improved' }, { key: 'c8_sitemap', label: 'Sitemap', kind: 'regressed' }],
  priorityFixes: [
    { key: 'c2_llms_txt', title: 'Resolve failure: c2_llms_txt', rationale: 'The current scan reports a fail for this check.', expectedImpact: 'high', nextStep: 'Review c2_llms_txt and apply the recommended correction.' },
    { key: 'agency-1', title: 'Rewrite the services page', rationale: 'Clients ask about pricing.', expectedImpact: 'medium', nextStep: 'Draft a pricing section.' },
    { key: 'c8_sitemap', title: 'Address regression: Sitemap', rationale: 'This reportable check has regressed since the earlier scan.', expectedImpact: 'high', nextStep: 'Review and improve Sitemap.' },
    { key: 'c4_structured_data', title: 'Review warning: c4_structured_data', rationale: 'x', expectedImpact: 'medium', nextStep: 'y' },
  ],
  executiveSummary: 'The site improved by seven points since the last comparable scan.',
  methodology: 'Scores use checks captured in this scan.',
  checks: Object.fromEntries(CHECK_SLOTS.map((slot, index) => [slot.key, index % 4 === 0 ? 'fail' : index % 4 === 1 ? 'warn' : index % 4 === 2 ? 'pass' : 'not-applicable'])),
  trend: [
    { date: '2026-06-01T08:00:00.000Z', score: 60, comparable: true },
    { date: '2026-06-15T08:00:00.000Z', score: 58, comparable: false },
    { date: '2026-07-01T08:00:00.000Z', score: 65, comparable: true },
    { date: '2026-07-21T08:00:00.000Z', score: 72, comparable: true },
  ],
}

function render(node: React.ReactNode, locale: 'en' | 'zh-HK' = 'en') {
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : zh} timeZone="UTC">{node}</NextIntlClientProvider>,
  )
}

describe('report page view-model', () => {
  it('keeps three fixes and re-words only the scan-derived ones', () => {
    const view = buildReportPage(snapshot)
    expect(view.fixes.map(fix => fix.kind)).toEqual(['check', 'custom', 'check'])
    expect(view.fixes[2]).toMatchObject({ checkKey: 'c8_sitemap', reason: 'regressed' })
    // A title that only looks derived, on a key that is not a check, is the agency's own words.
    expect(reportFixView({ key: 'robots', title: 'Resolve failure: robots', rationale: 'r', expectedImpact: 'low', nextStep: 'n' }).kind).toBe('custom')
  })

  it('draws not-applicable as not checked and flags a method change', () => {
    const view = buildReportPage(snapshot)
    expect(view.heatmap).toHaveLength(20)
    expect(view.heatmap!.some(tile => (tile.status as string) === 'not-applicable')).toBe(false)
    expect(view.methodChanged).toBe(true)
    expect(view.changeCounts).toEqual({ improved: 1, regressed: 1 })
  })
})

describe('OnePageReport', () => {
  it('renders the ring, trend, heatmap and top three fixes', () => {
    const html = render(<OnePageReport variant="page" printable snapshot={snapshot} publishedAt="2026-07-22T08:00:00.000Z" />)
    expect(html).toContain('Score 72 out of 100, grade B')
    expect(html).toContain('4 scans, from 60 to 72')
    expect(html).toContain('stroke-dasharray="6 5"')
    expect(html).toContain('Dashed line')
    expect((html.match(/data-testid="check-heatmap"/g) ?? [])).toHaveLength(1)
    expect(html).toContain('llms.txt Present: the scan found this check failing.')
    expect(html).toContain('Rewrite the services page')
    expect(html).toContain('Sitemap Quality: worse than in the earlier scan.')
    expect(html).not.toContain('c2_llms_txt')
    expect(html).not.toContain('Structured Data: the scan found this check needs work')
    expect(html).toContain('1 check improved · 1 regressed')
    expect(html).toContain('Download PDF')
    expect(html).toContain('<h1')
  })

  it('words the report in Traditional Chinese', () => {
    const html = render(<OnePageReport variant="page" snapshot={snapshot} />, 'zh-HK')
    expect(html).toContain('首 3 項改善')
    expect(html).toContain('分數走勢')
    expect(html).toContain('所有檢查一覽')
    expect(html).not.toContain('Download PDF')
  })

  it('sits under the page heading when embedded', () => {
    const html = render(<OnePageReport variant="embedded" snapshot={snapshot} />)
    expect(html).not.toContain('<h1')
    expect(html).toContain('<h2')
  })
})
