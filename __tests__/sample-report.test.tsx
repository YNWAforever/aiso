import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
vi.mock('@/lib/db', () => ({ db: () => { throw new Error('Sample must not access database') } }))
import { SampleReport } from '@/components/reports/SampleReport'
import { SAMPLE_REPORT } from '@/lib/reports/sample'
import { buildLocalizedMetadata } from '@/lib/seo'
import sitemap from '@/app/sitemap'
import { NAV } from '@/lib/navigation'
import config from '@/next.config'
import { unstable_getResponseFromNextConfig } from 'next/experimental/testing/server'

describe('synthetic public sample report', () => {
  it.each(['en','zh-HK'])('renders a synthetic illustration with localized metadata in %s', locale => {
    const html=renderToStaticMarkup(<SampleReport lang={locale}/>)
    expect(html).toContain(locale==='en'?'Synthetic sample':'合成示範')
    expect(html).toContain('example.invalid')
    expect(html).toContain('62')
    expect(html).toContain(locale==='en'?'Draft suggestion':'草稿建議')
    expect(html).toContain(`/${locale}/scan`)
    const metadata=buildLocalizedMetadata(locale,'/sample-report')
    expect(metadata.title).toBeTruthy()
    expect(metadata.alternates?.canonical).toContain(`/${locale}/sample-report`)
  })
  it('is static synthetic data with no customer identifiers or signed share payload',()=>{
    expect(SAMPLE_REPORT.synthetic).toBe(true)
    expect(JSON.stringify(SAMPLE_REPORT)).not.toMatch(/account_id|client_id|share_signature|public_slug/)
    expect(renderToStaticMarkup(<SampleReport lang="en"/>)).toContain('No comparable baseline')
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