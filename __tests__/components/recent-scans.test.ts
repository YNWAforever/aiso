import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { RecentScans, formatScanDate } from '@/components/dashboard/RecentScans'
const scan = {id:'scan-a',domain:'example.com',score:62,grade:'C',created_at:'2026-09-05T23:30:00.000Z'}
describe('real RecentScans rendering', () => {
  it.each(['en','zh-HK'])('preserves guarded result URLs and locale dates in %s', lang => {
    const html = renderToStaticMarkup(createElement(RecentScans,{lang,scans:[scan]}))
    expect(html).toContain(`href="/${lang}/result/scan-a"`)
    // 23:30 UTC on 5 Sep is 6 Sep in Hong Kong: the date follows the product's market.
    expect(html).toContain(lang === 'zh-HK' ? '2026年9月6日' : '6 Sept 2026')
    expect(html).toContain('dateTime="2026-09-05T23:30:00.000Z"')
    expect(html.replace(/<[^>]*>/g, '')).toContain(lang === 'zh-HK' ? '評級: C' : 'Grade: C')
  })
  it('preserves the optional owned-workspace result destination', () => {
    const html = renderToStaticMarkup(createElement(RecentScans,{lang:'en',clientId:'client-a',scans:[scan]}))
    expect(html).toContain('href="/en/dashboard/client-a/result/scan-a"')
  })
  it('does not render invalid dates or fabricate grades', () => {
    const html = renderToStaticMarkup(createElement(RecentScans,{lang:'en',scans:[{...scan,grade:null,created_at:''}]}))
    expect(html).toContain('Date unavailable')
    expect(html).not.toContain('Invalid Date')
    expect(html.replace(/<[^>]*>/g, '')).not.toContain('Grade:')
  })
})

it.each([null, undefined, '', 'not-a-date'])('missing or invalid observation date %s stays unknown', value => {
  expect(formatScanDate(value, 'en')).toBe('Date unavailable')
})

it.each(['en', 'zh-HK'])('UC05 hides failed scores and provides a reason destination in %s', lang => {
  const html = renderToStaticMarkup(createElement(RecentScans, { lang, scans: [{...scan, score: null, grade: null, displayState: 'failed'}] }))
  const text = html.replace(/<[^>]*>/g, '')
  expect(text).not.toContain('/ 100')
  expect(text).not.toContain('Grade:')
  expect(text).toContain(lang === 'zh-HK' ? '掃描未完成' : 'Scan incomplete')
  expect(html).toContain('href="/'+lang+'/result/scan-a"')
})
