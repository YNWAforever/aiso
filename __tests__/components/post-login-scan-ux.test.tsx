import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithIntl } from '@/__tests__/helpers/intl'
import type { Scan } from '@/lib/types'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

const state = vi.hoisted(() => ({ query: new URLSearchParams(), push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }), useSearchParams: () => state.query }))
import { ResultsStep } from '@/components/dashboard/ResultsStep'
import { ScanStep } from '@/components/dashboard/ScanStep'
import { ScanPicker } from '@/components/dashboard/ScanPicker'
import { safeReturnTo } from '@/lib/auth-return-to'
import { normalizeAuthNext } from '@/lib/auth-navigation'

export const savedScan = {
  id: 'older-scan', account_id: 'account-a', url: 'https://example.com/guide', domain: 'example.com',
  industry: 'technology', region: 'HK', score: 52, grade: 'C', created_at: '2026-10-01T08:00:00.000Z',
  results: {},
} as Scan
const choices = [
  { ...savedScan, id: 'latest-scan', score: 70, created_at: '2026-10-20T08:00:00.000Z' },
  savedScan,
]
beforeEach(() => { state.query = new URLSearchParams(); vi.clearAllMocks() })

describe('post-login scan UX', () => {
  it.each(['en', 'zh-HK'] as const)('keeps Results actions tied to the selected scan in %s', lang => {
    const html = renderWithIntl(<ResultsStep scan={savedScan} lang={lang} clientId="brand-a" />, lang)
    expect(html).toContain(`/${lang}/dashboard/brand-a?step=improve&amp;scanId=older-scan`)
    expect(html).toContain(`/${lang}/dashboard/brand-a/reports/new?scanId=older-scan`)
    expect(html).toContain(`/${lang}/dashboard/brand-a?step=scan&amp;scanId=older-scan`)
  })
  it.each(['en', 'zh-HK'] as const)('provides a labelled saved-scan GET picker in %s', lang => {
    const html = renderWithIntl(<ScanPicker lang={lang} action={`/${lang}/dashboard/brand-a`} step="results" scans={choices} selectedScanId="older-scan" />, lang)
    const copy = (lang === 'en' ? en : zh).dashboard
    expect(html).toContain('method="get"')
    expect(html).toContain('name="step" value="results"')
    expect(html).toContain('name="scanId"')
    expect(html).toContain('value="older-scan" selected=""')
    expect(html).toContain('value="latest-scan"')
    expect(html).toContain(copy.choose_saved_scan)
  })
  it('does not silently replace an invalid selection with the newest scan', () => {
    const html = renderWithIntl(<ScanPicker lang="en" action="/en/dashboard/brand-a/reports/new" scans={choices} selectedScanId="foreign" />)
    expect(html).not.toContain('value="latest-scan" selected')
    expect(html).not.toContain('value="older-scan" selected')
    expect(html).toMatch(/<option value=""[^>]*selected=""/)
  })
  it('prefills repeat scan URL, industry and region from the chosen scan', () => {
    const html = renderWithIntl(<ScanStep lang="en" clientId="brand-a" scan={savedScan} scanHistory={choices} />)
    expect(html).toContain('value="https://example.com/guide"')
    expect(html).toContain('value="technology" selected=""')
    expect(html).toContain('value="HK" selected=""')
  })
  it.each([
    ['en', ''], ['en', '&scanId=older-scan'],
    ['zh-HK', ''], ['zh-HK', '&scanId=older-scan'],
  ] as const)('prefills the recovery URL after logout and re-login in %s (%s)', (lang, scanQuery) => {
    const clientId = '11111111-1111-4111-8111-111111111111'
    const recovery = `/${lang}/dashboard/${clientId}?step=scan${scanQuery}&url=https%3A%2F%2Fbrand.example%2Flanding%3Fcampaign%3Dreport%26source%3Dold%23section`
    const returnTo = normalizeAuthNext(lang, safeReturnTo(recovery, lang))
    state.query = new URL(returnTo, 'https://auth.fixture').searchParams
    const html = renderWithIntl(<ScanStep lang={lang} clientId={clientId} scan={savedScan} scanHistory={choices} />, lang)
    expect(state.query.get('scanId')).toBe(scanQuery ? 'older-scan' : null)
    expect(html).toContain('value="https://brand.example/landing?campaign=report&amp;source=old#section"')
    expect(html).not.toContain('value="https://example.com/guide"')
  })
  it('uses the saved brand domain and industry when there is no previous scan', () => {
    const html = renderWithIntl(<ScanStep lang="en" clientId="brand-a" scan={null} scanHistory={[]} client={{ domain: 'example.com', industry: 'legal' }} />)
    expect(html).toContain('value="https://example.com"')
    expect(html).toContain('value="legal" selected=""')
  })
})
