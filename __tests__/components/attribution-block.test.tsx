import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MeasuredChangeBlock } from '@/components/attribution/MeasuredChangeBlock'
import en from '@/messages/en.json'
import zh from '@/messages/zh-HK.json'

// There is no DOM here, so the hooks are driven by hand, as in alerts-interaction.test.tsx:
// state lives in slots, effects are queued and run by settle().
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  locale: 'en' as 'en' | 'zh-HK',
  effects: [] as (() => unknown)[],
}))

vi.mock('react', async original => ({
  ...(await original<typeof import('react')>()),
  useState(initial: unknown) {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = initial
    return [hooks.slots[i], (next: unknown) => { hooks.slots[i] = typeof next === 'function' ? next(hooks.slots[i]) : next }]
  },
  useRef(initial: unknown) {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = { current: initial }
    return hooks.slots[i]
  },
  useEffect(fn: () => unknown, deps: unknown[]) {
    const i = hooks.cursor++
    const old = hooks.slots[i] as unknown[] | undefined
    if (!old || deps.some((v, j) => v !== old[j])) {
      hooks.effects.push(fn)
      hooks.slots[i] = deps
    }
  },
}))

vi.mock('next-intl', async original => {
  const actual = await original<typeof import('next-intl')>()
  return {
    ...actual,
    useLocale: () => hooks.locale,
    useTranslations: (namespace: 'attribution') =>
      actual.createTranslator({ locale: hooks.locale, messages: hooks.locale === 'en' ? en : zh, namespace }),
  }
})

const CLIENT = 'c1'
const ITEM = 'i1'
const VERSION = 'v1'

function mount(refreshKey = 0) {
  const render = () => {
    hooks.cursor = 0
    return <MeasuredChangeBlock clientId={CLIENT} itemId={ITEM} versionId={VERSION} refreshKey={refreshKey} />
  }
  return {
    html: () => renderToStaticMarkup(render()),
    async settle() {
      renderToStaticMarkup(render())
      for (const fn of hooks.effects.splice(0)) fn()
      await new Promise(resolve => setTimeout(resolve, 0))
    },
  }
}

const respond = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body }) as Response

beforeEach(() => {
  hooks.slots = []
  hooks.cursor = 0
  hooks.effects = []
  hooks.locale = 'en'
  vi.stubGlobal('fetch', vi.fn())
})

describe('MeasuredChangeBlock', () => {
  it('asks the measured-change route for this version, never cached', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond({ deliveredOn: null, windows: null, readyOn: null, targets: [] }))
    await mount().settle()
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('/api/clients/c1/work-items/i1/versions/v1/attribution')
    expect(init).toMatchObject({ cache: 'no-store' })
  })

  it('shows the title and a loading note before the answer arrives', () => {
    const out = mount().html()
    expect(out).toContain(en.attribution.measuredTitle)
    expect(out).toContain(en.attribution.measuredLoading)
  })

  it('says there is nothing to measure for a version never delivered', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond({ deliveredOn: null, windows: null, readyOn: null, targets: [] }))
    const view = mount()
    await view.settle()
    expect(view.html()).toContain(en.attribution.measuredNotDelivered)
    expect(view.html()).not.toContain('role="alert"')
  })

  it('renders the comparison windows and one row per target', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(respond({
      deliveredOn: '2026-10-01',
      windows: { before: { from: '2026-09-03', to: '2026-09-30' }, after: { from: '2026-10-02', to: '2026-10-29' } },
      readyOn: '2026-11-01',
      targets: [
        { scope: 'page', asset: { id: 'a', url: 'https://x.test/a', label: 'Alpha' }, status: 'not_ready', readyOn: '2026-11-01' },
        { scope: 'page', asset: { id: 'b', url: 'https://x.test/b', label: 'Beta' }, status: 'unavailable', reason: 'sync_failing' },
      ],
    }))
    const view = mount()
    await view.settle()
    const out = view.html()
    for (const text of ['2026-10-01', '2026-09-03', '2026-10-29', 'Alpha', 'Beta', '2026-11-01']) expect(out).toContain(text)
    expect(out).toContain('Search Console has not synced successfully lately')
    expect(out).toContain('aria-busy="false"')
  })

  it('renders in Traditional Chinese', async () => {
    hooks.locale = 'zh-HK'
    vi.mocked(fetch).mockResolvedValueOnce(respond({ deliveredOn: null, windows: null, readyOn: null, targets: [] }))
    const view = mount()
    await view.settle()
    expect(view.html()).toContain(zh.attribution.measuredTitle)
    expect(view.html()).toContain(zh.attribution.measuredNotDelivered)
  })

  it.each([
    ['a network failure', () => vi.mocked(fetch).mockRejectedValueOnce(new Error('PRIVATE_DETAIL postgresql://secret'))],
    ['an error status', () => vi.mocked(fetch).mockResolvedValueOnce(respond({ error: 'Unavailable' }, false))],
    ['a malformed body', () => vi.mocked(fetch).mockResolvedValueOnce(respond({ targets: [{ status: 'shiny' }] }))],
  ])('shows the unavailable copy after %s, without leaking the cause', async (_name, arrange) => {
    arrange()
    const view = mount()
    await view.settle()
    const out = view.html()
    expect(out).toContain(en.attribution.measuredUnavailable)
    expect(out).toContain('role="alert"')
    expect(out).toContain(en.attribution.measuredRetry)
    expect(out).not.toMatch(/PRIVATE_DETAIL|postgresql|Unavailable"/)
    expect(out).not.toContain(en.attribution.measuredNotDelivered)
  })
})
