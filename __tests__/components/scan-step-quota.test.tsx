import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }))

import { ScanStep } from '@/components/dashboard/ScanStep'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const props = { lang: 'en', clientId: 'c1', scan: null, scanHistory: [] }

describe('ScanStep quota', () => {
  it.each(['en', 'zh-HK'] as const)('shows the scans left this month on a metered plan in %s', lang => {
    const html = renderWithIntl(<ScanStep {...props} lang={lang} quota={{ kind: 'metered', limit: 3, remaining: 2 }} />, lang)
    const copy = (lang === 'en' ? en : zh).dashboard.upgrade
    expect(html).toContain(copy.scansLeft.replace('{remaining}', '2').replace('{limit}', '3'))
    expect(html).toContain('<form')
  })
  it('replaces the form with one upgrade button when the month is used up', () => {
    const html = renderWithIntl(<ScanStep {...props} quota={{ kind: 'metered', limit: 3, remaining: 0 }} />)
    expect(html).toContain(en.dashboard.upgrade.scansOutTitle)
    expect(html).toContain('href="/en/pricing"')
    expect(html).not.toContain('<form')
  })
  it('asks a Free account to upgrade instead of letting the API refuse', () => {
    const html = renderWithIntl(<ScanStep {...props} quota={{ kind: 'upgrade' }} />)
    expect(html).toContain(en.dashboard.upgrade.freeTitle)
    expect(html).not.toContain('<form')
  })
  it('says nothing about quota when the count could not be read, or the plan is unlimited', () => {
    for (const quota of [{ kind: 'metered', limit: 3, remaining: null } as const, { kind: 'unlimited' } as const]) {
      const html = renderWithIntl(<ScanStep {...props} quota={quota} />)
      expect(html).not.toContain('data-testid="scans-left"')
      expect(html).toContain('<form')
    }
  })
})
