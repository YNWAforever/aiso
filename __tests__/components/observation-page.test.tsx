import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  load: vi.fn(),
  ServiceError: class extends Error {
    constructor(public code: string) {
      super(code)
    }
  },
}))
const load = h.load
vi.mock('@/lib/auth', () => ({ requireAuth: h.auth }))
vi.mock('@/lib/observations/service', () => ({
  loadAuthenticatedObservations: h.load,
  ObservationServiceError: h.ServiceError,
}))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`)
  },
  notFound: () => {
    throw new Error('not-found')
  },
}))
vi.mock('next-intl/server', () => ({
  getTranslations: async () =>
    Object.assign((key: string) => key, { raw: (key: string) => key === 'recordedRows' ? '{count} recorded rows' : key }),
}))
import Page from '@/app/[lang]/dashboard/[clientId]/observations/page'
const ObservationServiceError = h.ServiceError
const params = Promise.resolve({ lang: 'zh-HK', clientId: 'client-a' }),
  initial = {
    schemaVersion: 1,
    clientId: 'client-a',
    selectedWeek: '2026-01-01',
    weeks: [],
    questionsTruncated: false,
    questions: [],
    items: [],
    counts: { recordedRows: 0, successfulRows: 0, incompleteRows: 0 },
    nextCursor: null,
  }
beforeEach(() => {
  load.mockReset()
  h.auth.mockReset()
})
describe('observation page boundary', () => {
  it('authenticates independently before loading observations', async () => {
    h.auth.mockRejectedValue(new Error('redirect:login'))
    await expect(
      Page({ params, searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('redirect:login')
    expect(load).not.toHaveBeenCalled()
  })
  it('awaits query filters and preserves them in rendered controls', async () => {
    load.mockResolvedValue(initial)
    const html = renderToStaticMarkup(
      await Page({
        params,
        searchParams: Promise.resolve({
          promptId: 'p',
          platform: 'ChatGPT',
          week: '2025-01-01',
          result: 'success',
        }),
      }),
    )
    expect(load.mock.calls[0][1].toString()).toBe(
      'promptId=p&platform=ChatGPT&week=2025-01-01&result=success',
    )
    expect(html).toContain('selected="">2025-01-01')
    expect(html).toContain('value="p" selected=""')
    expect(html).toContain('name="platform" value="ChatGPT"')
    expect(html).toContain('<option value="ChatGPT"></option>')
    expect(html).toContain('0 recorded rows')
  })
  it('redirects unauthenticated users', async () => {
    load.mockRejectedValue(new ObservationServiceError('UNAUTHENTICATED'))
    await expect(
      Page({ params, searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('redirect:/zh-HK/auth/login')
  })
  it.each(['INVALID_OBSERVATION_QUERY', 'CLIENT_NOT_FOUND'])(
    'hides %s',
    async (code) => {
      load.mockRejectedValue(new ObservationServiceError(code))
      await expect(
        Page({ params, searchParams: Promise.resolve({}) }),
      ).rejects.toThrow('not-found')
    },
  )
  it('renders translated retry for unavailable service', async () => {
    load.mockRejectedValue(
      new ObservationServiceError('OBSERVATIONS_UNAVAILABLE'),
    )
    const html = renderToStaticMarkup(
      await Page({ params, searchParams: Promise.resolve({}) }),
    )
    expect(html).toContain('loadError')
    expect(html).toContain('retry')
  })
})
