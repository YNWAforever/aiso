import { expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import { buildScanEvidence } from '@/lib/scan-evidence'
import { buildScanSummaryView } from '@/lib/view-models/scan-summary'
import { ScanSummary } from '@/components/dashboard/ScanSummary'
import { ResultsStep } from '@/components/dashboard/ResultsStep'
import { OpportunityWorkspace } from '@/components/opportunities/OpportunityWorkspace'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import type { Scan } from '@/lib/types'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const id = '22222222-2222-4222-8222-222222222222'
function fixture() {
  const evidence = buildScanEvidence({
    requestedUrl: 'https://example.test', evaluatedUrl: 'https://example.test',
    industry: 'technology', region: 'HK', sitemapSource: 'unknown', collectedAt: '2026-10-17T05:30:00Z',
    checks: { c1_robots: { assessment: 'pass', collection: 'complete' }, c9_meta_desc: { assessment: 'fail', collection: 'complete' } },
    observations: [{ check: 'page', collection: 'complete', httpStatus: 200, target: { origin: 'https://example.test' } }],
  })
  const scan = { id, domain: 'example.test', url: 'https://example.test', score: 88, grade: 'A', created_at: '2026-10-17T05:30:00Z',
    results: { evidence, c1_robots: { status: 'pass', message: 'robots_ai_allowed' }, c9_meta_desc: { status: 'fail', message: 'meta_desc_missing' } } } as unknown as Scan
  const view = buildScanSummaryView(scan)
  return { scan, view }
}
const render = (node: React.ReactNode, lang: string) => renderToStaticMarkup(
  <NextIntlClientProvider locale={lang} timeZone="UTC" messages={lang === 'en' ? en : zh}>{node}</NextIntlClientProvider>,
)
for (const lang of ['en', 'zh-HK']) {
  it(`separates observed coverage from passing checks and labels the limited diagnostic in ${lang}`, () => {
    const { scan, view } = fixture()
    const html = render(<ScanSummary scan={scan} view={view} brandName="Synthetic Brand" />, lang)
    expect(html).toContain('Synthetic Brand')
    expect(html).toContain(lang === 'en' ? 'Observed checks: 2/20' : '已觀察檢查：2/20')
    expect(html).toContain(lang === 'en' ? 'Passing observed checks: 1/2' : '已觀察檢查中通過：1/2')
    expect(html).toContain(lang === 'en' ? 'Provisional website diagnostic' : '暫定網站診斷')
    expect(html).not.toContain('1/20')
    expect(html).not.toContain('meta_desc_missing')
    expect(html).not.toContain('>meta desc<')
    expect(html).toContain((lang === 'en' ? en : zh).checks.c9_meta_desc)
    expect(html).toContain((lang === 'en' ? en : zh).checks.meta_desc_missing)
    if (lang === 'zh-HK') {
      expect(html).not.toContain('>Core<')
      expect(html).not.toContain('>Extended<')
      expect(html).not.toContain('Oct ')
    }
  })
  it(`keeps verified findings accessible when the score is missing in ${lang}`, () => {
    const { scan, view } = fixture()
    const html = render(<ResultsStep scan={{ ...scan, score: null } as unknown as Scan} view={{ ...view, state: 'unknown', score: null }}
      brandName="Synthetic Brand" lang={lang} clientId="11111111-1111-4111-8111-111111111111" />, lang)
    expect(html).toContain(`step=improve&amp;scanId=${id}`)
    expect(html).toContain((lang === 'en' ? en : zh).checks.c9_meta_desc)
    expect(html).not.toContain('>0<')
  })
  it(`refuses an unrelated scan projection and does not promote historical raw passes in ${lang}`, () => {
    const { scan, view } = fixture()
    const html = render(<ScanSummary scan={scan} view={{ ...view, scanId: 'foreign-scan' }} />, lang)
    expect(html).toContain(lang === 'en' ? 'Collection evidence unavailable' : '未能提供採集證據')
    expect(html).not.toContain('>88<')
    expect(html).not.toContain('Passing observed checks: 1/2')
  })
  it(`shows at most three eligible priorities for the selected scan in ${lang}`, () => {
    const { scan } = fixture()
    const evidence = buildScanEvidence({
      requestedUrl: 'https://example.test', evaluatedUrl: 'https://example.test', industry: 'technology', region: 'HK', sitemapSource: 'unknown',
      checks: Object.fromEntries(['c1_robots', 'c9_meta_desc', 'c10_headings', 'c11_faq', 'c15_entity', 'c17_citation_density']
        .map((key, index) => [key, { assessment: index < 2 ? 'fail' : 'warn', collection: 'complete' }])),
    })
    const suggestions = deriveSuggestions({ kind: 'scan-check', scanId: id, recordedAt: null, envelope: evidence })
    const initial = { schemaVersion: 1 as const, window: { pulseWeek: null, pulseLimit: 200 as const, pulseTruncated: false, scanId: id },
      sourceStates: { pulse: 'empty' as const, scan: 'ok' as const }, savedDraftsState: 'ok' as const, partial: true,
      suggestions: suggestions.map(row => ({ ...row, savedState: 'unsaved' as const, saveAvailability: 'available' as const })) }
    const html = render(<OpportunityWorkspace clientId="11111111-1111-4111-8111-111111111111" scanId={scan.id} initial={initial} />, lang)
    const copy = (lang === 'en' ? en : zh).opportunities
    expect(html.match(new RegExp(`>${copy.saveDraft}<`, 'g'))).toHaveLength(3)
    expect(html).toContain(lang === 'en' ? 'Showing 3 of 6 eligible findings' : '顯示 6 項合資格發現中的 3 項')
  })
}
