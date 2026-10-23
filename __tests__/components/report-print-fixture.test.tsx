import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { OnePageReport } from '@/components/reports/OnePageReport'
import { sampleReportSnapshot } from '@/lib/reports/sample'
import { parseClientReportSnapshot } from '@/lib/reports/client-dto'
import { PRINT_ZOOM_STEPS, reportPrintLayout } from '@/lib/view-models/report-page'
import type { ClientReportSnapshotV1, ReportLocale } from '@/lib/reports/types'
import { renderWithIntl } from '@/__tests__/helpers/intl'

// Offline print fixtures for tests/e2e/report-print.spec.ts: the real report,
// server-rendered with the real catalogue, at the longest text a report
// accepts (a 1,200-character summary, three 1,200-character recommendations).

const SENTENCE = {
  en: 'Customers ask assistants which local providers offer same-day service, and the answer depends on pages that state it plainly. ',
  'zh-HK': '顧客會向人工智能助理查詢哪些本地服務商提供即日服務，而答案取決於網站是否清楚列明相關資料，並以容易擷取的方式呈現。',
} as const

function text(locale: ReportLocale, length: number): string {
  return SENTENCE[locale].repeat(Math.ceil(length / SENTENCE[locale].length)).slice(0, length).trim()
}

function snapshot(locale: ReportLocale, summary: number, fix: number): ClientReportSnapshotV1 {
  const base = sampleReportSnapshot(locale, { agency: 'Northwind Digital', brand: 'Example Brand', summary: text(locale, summary), method: text(locale, 300) })
  if (!fix) return base
  return {
    ...base,
    priorityFixes: ['content', 'schema', 'faq'].map((key, index) => {
      const body = text(locale, fix)
      return { key, title: key, rationale: body, expectedImpact: index ? 'medium' : 'high', nextStep: body }
    }),
  }
}

const LOCALES = ['en', 'zh-HK'] as const
const STATES: Record<string, (locale: ReportLocale) => ClientReportSnapshotV1> = {
  sample: locale => sampleReportSnapshot(locale, { agency: 'Northwind Digital', brand: 'Example Brand', summary: text(locale, 240), method: text(locale, 200) }),
  medium: locale => snapshot(locale, 700, 500),
  longest: locale => snapshot(locale, 1200, 1200),
  legacy: locale => {
    const { checks: _checks, trend: _trend, ...older } = snapshot(locale, 1200, 0)
    return older
  },
}

const render = (locale: ReportLocale, state: string) =>
  renderWithIntl(<OnePageReport variant="page" printable snapshot={STATES[state]!(locale)} publishedAt="2026-09-02T00:00:00.000Z" />, locale)

describe('report print fixtures', () => {
  it.each(LOCALES)('are valid snapshots that a report could really hold in %s', locale => {
    for (const build of Object.values(STATES)) expect(parseClientReportSnapshot(build(locale))).not.toBeNull()
  })

  it('shrinks the print as the text grows, and never below the last step', () => {
    const layouts = ['sample', 'medium', 'longest'].map(state => reportPrintLayout(STATES[state]!('zh-HK')))
    const zooms = layouts.map(layout => layout.zoom)
    expect(zooms).toEqual([...zooms].sort((a, b) => b - a))
    expect(zooms.at(-1)).toBe(PRINT_ZOOM_STEPS.at(-1)!.zoom)
    // Only past the last step is an agency's text cut, and only in print.
    expect(layouts.map(layout => layout.shortenFixes)).toEqual([false, false, true])
    expect(reportPrintLayout(STATES.longest!('en')).shortenFixes).toBe(false)
  })

  it('prints a recommendation once when its next step repeats it', () => {
    const html = renderWithIntl(<OnePageReport variant="page" snapshot={snapshot('en', 300, 1200)} />, 'en')
    expect(html.split(text('en', 1200)).length - 1).toBe(3)
  })
})

afterAll(() => {
  const directory = process.env.AISO_REPORT_HTML_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  for (const locale of LOCALES) {
    for (const state of Object.keys(STATES)) writeFileSync(join(directory, `${locale}-${state}.html`), render(locale, state), 'utf8')
  }
})
