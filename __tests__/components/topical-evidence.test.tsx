import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DeepGeoSection } from '@/components/result/DeepGeoSection'
import { ExpandableCheckItem } from '@/components/ExpandableCheckItem'

const locale = vi.hoisted(() => ({ value: 'en' }))
vi.mock('next-intl', () => ({ useLocale: () => locale.value }))
const zeros = { topicalCoverageScore: 0, totalClusters: 0, hasOrphanPages: 0, detectedClusters: [] }

describe('missing topical evidence', () => {
  it.each(['en', 'zh-HK'])('hides placeholder zeros and remedial controls in %s', lang => {
    locale.value = lang
    for (const collection of ['unsupported', 'failed', 'unknown']) {
      const check = { status: 'warn', message: 'topical_authority_no_sitemap', diagnostic: { collection, reason: 'no-input' } }
      const html = renderToStaticMarkup(createElement(DeepGeoSection, { c19: zeros, c19Check: check } as never))
      expect(html).toContain(lang === 'en' ? 'Unavailable' : '未能取得')
      expect(html).not.toContain('0/100')
      expect(html).not.toContain(lang === 'en' ? '0 topic clusters' : '偵測到 0 個主題群組')
      const item = renderToStaticMarkup(<ExpandableCheckItem label="Topical authority" result={check as never} message="Incomplete topical coverage" explanation={{ question: 'Coverage?', why: 'Context.', fix: { pass: 'Good', warn: 'Build pillar pages', fail: 'Build pillar pages' } }} />)
      expect(item).not.toContain('<button')
      expect(item).not.toContain('Incomplete topical coverage')
      expect(item).toContain(lang === 'en' ? 'Unavailable' : '未能取得')
    }
  })
  it('does not treat historical numeric placeholders as observed evidence', () => {
    locale.value = 'en'
    const html = renderToStaticMarkup(<DeepGeoSection c19={zeros} />)
    expect(html).toContain('Legacy')
    expect(html).not.toContain('0/100')
  })
  it('retains a measured zero and real counts for a partial inferred assessment', () => {
    locale.value = 'en'
    const check = { status: 'fail', message: 'topical_authority_fail', diagnostic: { collection: 'partial', reason: 'inferred-only' } }
    const html = renderToStaticMarkup(createElement(DeepGeoSection, { c19: { ...zeros, totalClusters: 2 }, c19Check: check } as never))
    expect(html).toContain('0/100')
    expect(html).toContain('2 topic clusters')
    expect(html).not.toContain('Unavailable')
  })
})
