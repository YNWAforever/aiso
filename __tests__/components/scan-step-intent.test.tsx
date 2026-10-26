import { beforeEach, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
const h = vi.hoisted(() => ({ query: new URLSearchParams(), push: vi.fn() }))
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useEffect: (effect: () => void) => effect(),
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
}))
vi.mock('next/navigation', () => ({ useSearchParams: () => h.query, useRouter: () => ({ push: h.push }) }))
vi.mock('next-intl', async original => {
  const actual = await original<typeof import('next-intl')>()
  return { ...actual, useLocale: () => 'en', useTranslations: (namespace: 'dashboard' | 'dashboard.upgrade') => actual.createTranslator({ locale: 'en', messages: en, namespace }) }
})
import { ScanStep } from '@/components/dashboard/ScanStep'
beforeEach(() => {
  vi.clearAllMocks()
  h.query = new URLSearchParams('url=https%3A%2F%2Fexample.invalid')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'new-scan' }) }))
})
it('does not auto-submit a URL when an explicit scan selection is missing or invalid', () => {
  h.query.set('scanId', 'missing-scan')
  ScanStep({ lang: 'en', clientId: 'brand-a', scan: null, scanHistory: [] })
  expect(fetch).not.toHaveBeenCalled()
})
it('keeps the existing first-scan onboarding auto-submit', async () => {
  ScanStep({ lang: 'en', clientId: 'brand-a', scan: null, scanHistory: [] })
  await vi.waitFor(() => expect(h.push).toHaveBeenCalledWith('/en/dashboard/brand-a?step=results&scanId=new-scan'))
  expect(fetch).toHaveBeenCalledTimes(1)
})
it('does not auto-submit when the plan requires an upgrade', () => {
  ScanStep({ lang: 'en', clientId: 'brand-a', scan: null, scanHistory: [], quota: { kind: 'upgrade' } })
  expect(fetch).not.toHaveBeenCalled()
})
