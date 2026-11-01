import { beforeEach, expect, it, vi } from 'vitest'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

vi.mock('server-only', () => ({}))
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  ServiceError: class extends Error {
    constructor(public code: string) {
      super(code)
    }
  },
}))
vi.mock('@/lib/opportunities/service', () => ({
  loadAuthenticatedOpportunities: mocks.load,
  OpportunityServiceError: mocks.ServiceError,
}))

function lookup(messages: object, path: string): string {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined
    return (value as Record<string, unknown>)[key]
  }, messages) as string
}
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: 'en' | 'zh-HK'; namespace: string }) =>
    (key: string, values?: Record<string, string>) => {
      const root = locale === 'en' ? en : zh
      const value = lookup(root, `${namespace}.${key}`)
      return Object.entries(values ?? {}).reduce((copy, [name, replacement]) => copy.replaceAll(`{${name}}`, replacement), value)
    },
}))

import { loadStudioOpportunities } from '@/lib/conversation-studio/opportunities'
import { initial } from '@/__tests__/components/c9c-fixtures'

const clientId = '11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.load.mockResolvedValue(initial)
})

it.each(['en', 'zh-HK'] as const)('projects owned suggestions to localized Studio titles and evidence refs in %s', async lang => {
  const result = await loadStudioOpportunities(clientId, lang)
  const copy = (lang === 'en' ? en : zh).opportunities
  expect(result).toMatchObject({
    state: 'ready',
    partial: true,
    pulseWeek: '2026-09-01',
    sourceStates: { pulse: 'ok', scan: 'unavailable' },
    suggestions: [{
      key: 'pulse-fixture',
      title: copy.rules['review-question-coverage'].title,
      recordedAt: null,
      evidenceRefs: [{ kind: 'pulse-metric', id: '33333333-3333-4333-8333-333333333333' }],
    }],
  })
  expect(result?.suggestions[0].action).toContain('Historical <script>alert(1)</script> 問題')
  expect(JSON.stringify(result)).not.toMatch(/fingerprint|answerDigest|evidenceVersions|raw_answer/)
  expect(mocks.load).toHaveBeenCalledWith(clientId)
})

it('renders an honest empty state only when source reads completed without candidates', async () => {
  mocks.load.mockResolvedValue({
    ...initial,
    suggestions: [],
    groups: [],
    partial: false,
    sourceStates: { pulse: 'empty', scan: 'empty' },
  })
  expect(await loadStudioOpportunities(clientId, 'en')).toMatchObject({
    state: 'empty',
    suggestions: [],
    sourceStates: { pulse: 'empty', scan: 'empty' },
  })
})

it('keeps a partial or unavailable read pending instead of claiming none', async () => {
  mocks.load.mockResolvedValue({
    ...initial,
    suggestions: [],
    groups: [],
    partial: true,
    sourceStates: { pulse: 'empty', scan: 'unavailable' },
  })
  expect(await loadStudioOpportunities(clientId, 'en')).toMatchObject({ state: 'pending', suggestions: [] })
  mocks.load.mockRejectedValue(new mocks.ServiceError('OPPORTUNITIES_UNAVAILABLE'))
  expect(await loadStudioOpportunities(clientId, 'en')).toMatchObject({
    state: 'pending',
    suggestions: [],
    sourceStates: { pulse: 'unavailable', scan: 'unavailable' },
  })
})

it.each(['CLIENT_NOT_FOUND', 'UNAUTHENTICATED'])('fails closed on %s without serializing data', async code => {
  mocks.load.mockRejectedValue(new mocks.ServiceError(code))
  expect(await loadStudioOpportunities(clientId, 'en')).toBeNull()
})

it('runs no vendor or network request while reading saved opportunity evidence', async () => {
  const outbound = vi.fn(() => { throw new Error('outbound provider request forbidden') })
  vi.stubGlobal('fetch', outbound)
  await loadStudioOpportunities(clientId, 'en')
  expect(outbound).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})
