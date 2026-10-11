import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { NextIntlClientProvider } from 'next-intl'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CitationExplorer, domainsOfKind } from '@/components/dashboard/CitationExplorer'
import { buildCitationReport, type CitationAnswer } from '@/lib/citations/report'

const messages = (locale: 'en' | 'zh-HK') =>
  JSON.parse(readFileSync(join(process.cwd(), `messages/${locale}.json`), 'utf8'))

const answer = (overrides: Partial<CitationAnswer>): CitationAnswer => ({
  scan_week: '2026-10-05', platform: 'perplexity-sonar', prompt_id: 'p1', question: 'Best bank in Hong Kong?', provider_citations: [], ...overrides,
})
const report = buildCitationReport({
  context: { ownedDomains: ['fimmick.com'], competitors: [{ name: 'HSBC Holdings', domains: ['hsbc.com.hk'] }] },
  answers: [
    answer({ provider_citations: [{ url: 'https://www.hsbc.com.hk/rates', title: 'HSBC rates' }, { url: 'https://www.scmp.com/x', title: null }] }),
    answer({ prompt_id: 'p2', question: 'Cheapest loan?', provider_citations: [{ url: 'https://fimmick.com/loans', title: 'Our loans' }] }),
    answer({ prompt_id: 'p2', platform: 'gpt-4o', provider_citations: null }),
    answer({ scan_week: '2026-09-28', provider_citations: [{ url: 'https://lihkg.com/thread/1', title: null }] }),
  ],
})

const render = (value = report, locale: 'en' | 'zh-HK' = 'en') => renderToStaticMarkup(
  <NextIntlClientProvider locale={locale} messages={messages(locale)} timeZone="UTC">
    <CitationExplorer report={value} clientId="client-1" />
  </NextIntlClientProvider>,
)

describe('CitationExplorer', () => {
  it('summarises coverage honestly, separating unrecorded answers', () => {
    const html = render()
    expect(html).toContain('2026-09-28 to 2026-10-05')
    expect(html).toContain('3 answers listed sources · 0 listed none · 1 have no record of sources')
    expect(html).toContain('Search capability or a search request does not guarantee returned citations.')
  })

  it('lists questions where a competitor is cited and the brand is not', () => {
    const html = render()
    expect(html).toContain('Questions where competitors are cited and you are not')
    expect(html).toMatch(/<th scope="row"[^>]*>Best bank in Hong Kong\?<\/th><td[^>]*>HSBC Holdings/)
    expect(html).not.toMatch(/<th scope="row"[^>]*>Cheapest loan\?/)
  })

  it('labels each site with its type and the competitor it belongs to', () => {
    const html = render()
    expect(html).toContain('Competitor · HSBC Holdings')
    expect(html).toContain('Your site')
    expect(html).toContain('News and reference')
    expect(html).toContain('Forum')
  })

  it('offers a filter chip per type present, as toggle buttons', () => {
    const html = render()
    expect(html).toContain('role="group" aria-label="Filter by source type"')
    expect(html).toContain('aria-pressed="true"')
    expect(html).toMatch(/aria-pressed="false"[^>]*>Your site</)
    expect(html).not.toMatch(/aria-pressed="false"[^>]*>Social</)   // no social site cited
  })

  it('opens cited pages without passing our referrer or ranking', () => {
    const html = render()
    expect(html).toContain('href="https://hsbc.com.hk/rates" target="_blank" rel="noopener noreferrer nofollow"')
    expect(html).toContain('HSBC rates')
    expect(html).toContain('href="/api/dashboard/clients/client-1/citations?format=csv"')
  })

  it('renders in Traditional Chinese', () => {
    const html = render(report, 'zh-HK')
    expect(html).toContain('競爭對手被引用而您沒有的問題')
    expect(html).toContain('競爭對手 · HSBC Holdings')
    expect(html).toContain('3 個回答列出來源')
  })

  it('explains an empty report instead of showing empty tables', () => {
    const empty = buildCitationReport({ context: { ownedDomains: [], competitors: [] }, answers: [] })
    const html = render(empty)
    expect(html).toContain('No cited sources yet.')
    expect(html).not.toContain('<table')
    expect(html).not.toContain('format=csv')
  })
})

describe('domainsOfKind', () => {
  it('filters the sites table by type and keeps the order for all', () => {
    expect(domainsOfKind(report.domains, 'competitor').map(d => d.domain)).toEqual(['hsbc.com.hk'])
    expect(domainsOfKind(report.domains, 'all')).toEqual(report.domains)
    expect(domainsOfKind(report.domains, 'social')).toEqual([])
  })
})

it.each(['en','zh-HK'] as const)('renders prerequisite states and never claims no gap without domains in %s',locale=>{
 const r=buildCitationReport({context:{ownedDomains:[],competitors:[]},answers:[answer({provider_citations:[{url:'https://source.example/x'}]})]});const html=render(r,locale);const c=messages(locale).citations;expect(html).toContain(c.gap_not_configured);expect(html).toContain('step=competitors');expect(html).not.toContain(c.gaps_none);
});
