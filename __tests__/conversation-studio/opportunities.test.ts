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
import { initial, scanSuggestion } from '@/__tests__/components/c9c-fixtures'

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
      source: { kind: 'pulse-metric', id: '33333333-3333-4333-8333-333333333333' },
      ruleVersion: 'pulse-brand-absent.v1',
      fingerprint: 'a'.repeat(64),
      savedDraftId: null,
      savedState: 'unavailable',
      saveAvailability: 'available',
    }],
  })
  expect(result?.suggestions[0].action).toContain('Historical <script>alert(1)</script> 問題')
  expect(result?.suggestions[0]).not.toHaveProperty('evidence')
  expect(result?.suggestions[0]).not.toHaveProperty('args')
  expect(JSON.stringify(result)).not.toMatch(/answerDigest|evidenceVersions|raw_answer|provenance/)
  expect(mocks.load).toHaveBeenCalledWith(clientId)
})


it('forwards the scan-check create contract and saved draft without evidence envelopes', async () => {
  mocks.load.mockResolvedValue({
    ...initial,
    suggestions: [{ ...scanSuggestion, savedDraftId: '55555555-5555-4555-8555-555555555555', savedState: 'saved' }],
  })
  const result = await loadStudioOpportunities(clientId, 'en')
  expect(result?.suggestions[0]).toMatchObject({
    source: { kind: 'scan-check', id: scanSuggestion.source.id, checkKey: scanSuggestion.source.checkKey },
    ruleVersion: 'scan-check-gap.v1',
    fingerprint: scanSuggestion.fingerprint,
    savedDraftId: '55555555-5555-4555-8555-555555555555',
    savedState: 'saved',
    saveAvailability: 'available',
  })
  expect(JSON.stringify(result)).not.toMatch(/envelope|answerDigest|evidenceVersions|raw_answer/)
})

it('keeps limited-evidence saveability visible and drops agent recommendations', async () => {
  mocks.load.mockResolvedValue({
    ...initial,
    suggestions: [
      { ...initial.suggestions[0], saveAvailability: 'limited-evidence' },
      { ...initial.suggestions[0], key: 'agent-fixture', source: { kind: 'agent-recommendation', id: '77777777-7777-4777-8777-777777777777' } },
    ],
  })
  const result = await loadStudioOpportunities(clientId, 'en')
  expect(result?.suggestions).toHaveLength(1)
  expect(result?.suggestions[0]).toMatchObject({ key: 'pulse-fixture', saveAvailability: 'limited-evidence' })
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
