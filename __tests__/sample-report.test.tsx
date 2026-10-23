import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import enMessages from '@/messages/en.json'
import zhMessages from '@/messages/zh-HK.json'
vi.mock('@/lib/db', () => ({ db: () => { throw new Error('Sample must not access database') } }))
import { SampleReport } from '@/components/reports/SampleReport'
import { SAMPLE_REPORT, sampleReportSnapshot } from '@/lib/reports/sample'
import { parseClientReportSnapshot } from '@/lib/reports/client-dto'

const render=(locale:string)=>renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={locale==='zh-HK'?zhMessages:enMessages} timeZone="UTC"><SampleReport lang={locale}/></NextIntlClientProvider>)
import { buildLocalizedMetadata } from '@/lib/seo'
import sitemap from '@/app/sitemap'
import { NAV } from '@/lib/navigation'
import config from '@/next.config'
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server'

describe('synthetic public sample report', () => {
  it.each(['en','zh-HK'])('renders a synthetic illustration with localized metadata in %s', locale => {
    const html=render(locale)
    expect(html).toContain(locale==='en'?'Synthetic sample':'合成示範')
    expect(html).toContain('example.invalid')
    expect(html).toContain('62')
    expect(html).toContain(locale==='en'?'Top 3 fixes':'首 3 項改善')
    expect(html).toContain('data-testid="check-heatmap"')
    expect(html).toContain(locale==='en'?'Download PDF':'下載 PDF')
    expect((html.match(/<h1/g)??[])).toHaveLength(1)
    expect(html).toContain(`/${locale}/scan`)
    const metadata=buildLocalizedMetadata(locale,'/sample-report')
    expect(metadata.title).toBeTruthy()
    expect(metadata.alternates?.canonical).toContain(`/${locale}/sample-report`)
  })
  it('is static synthetic data with no customer identifiers or signed share payload',()=>{
    expect(SAMPLE_REPORT.synthetic).toBe(true)
    expect(JSON.stringify(SAMPLE_REPORT)).not.toMatch(/account_id|client_id|share_signature|public_slug/)
    expect(render('en')).toContain('Invented history')
    // The sample is a valid snapshot by the same rules a real one must meet.
    for(const locale of ['en','zh-HK'] as const) expect(parseClientReportSnapshot(sampleReportSnapshot(locale,{agency:'A',brand:'B',summary:'S',method:'M'}))).not.toBeNull()
  })
  it('activates exactly two localized sample sitemap entries and no demo destination',()=>{
    expect(NAV.find(entry=>entry.href==='/sample-report')?.available).toBe(true)
    expect(sitemap().filter(entry=>entry.url.endsWith('/sample-report'))).toHaveLength(2)
    expect(sitemap().some(entry=>entry.url.endsWith('/r/demo'))).toBe(false)
  })
  it('uses only temporary demo redirects and leaves arbitrary share slugs alone',async()=>{
    const redirects=await config.redirects!()
    expect(redirects).toContainEqual({source:'/r/demo',destination:'/en/sample-report',permanent:false})
    expect(redirects).toContainEqual({source:'/:lang(en|zh-HK)/r/demo',destination:'/:lang/sample-report',permanent:false})
    expect(redirects.some(entry=>entry.source.includes('/r/:slug'))).toBe(false)
  })
})

it.each(['','/en','/zh-HK'])('serves a 307 demo redirect with locale/query preserved for %s',async locale=>{
  const response=await unstable_getResponseFromNextConfig({url:`https://example.test${locale}/r/demo?ref=sample`,nextConfig:config})
  expect(response.status).toBe(307)
  expect(response.headers.get('location')).toBe(`https://example.test${locale||'/en'}/sample-report?ref=sample`)
})