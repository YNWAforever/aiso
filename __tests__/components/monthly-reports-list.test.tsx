import { beforeEach, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MonthlyReportsList } from '@/components/reports/MonthlyReportsList'

const hooks = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  refresh: vi.fn(),
}))

vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState(initial: unknown) {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = initial
    return [hooks.slots[i], (next: unknown) => {
      hooks.slots[i] = typeof next === 'function' ? (next as (value: unknown) => unknown)(hooks.slots[i]) : next
    }]
  },
  useRef(initial: unknown) {
    const i = hooks.cursor++
    if (!(i in hooks.slots)) hooks.slots[i] = { current: initial }
    return hooks.slots[i]
  },
  useEffect(fn: () => unknown, deps: unknown[]) {
    const i = hooks.cursor++
    const old = hooks.slots[i] as unknown[] | undefined
    if (!old || deps.some((value, j) => value !== old[j])) hooks.slots[i] = deps
  },
}))
vi.mock('next-intl', async original => {
  const actual = await original<typeof import('next-intl')>()
  return {
    ...actual,
    // No locale means untranslated keys, which is enough to find controls.
    useTranslations: () => (key: string) => key,
  }
})
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }))

const CLIENT = '11111111-1111-4111-8111-111111111111'
type Node = ReactElement<{ children?: ReactNode; onClick?: () => void }>
function nodes(node: ReactNode): Node[] {
  return Children.toArray(node).flatMap(child => isValidElement(child)
    ? [child as Node, ...nodes((child as Node).props.children)]
    : [])
}
type Row = {
  reportId: string
  month: string
  status: 'draft' | 'published' | 'revoked'
  publicSlug: string
  shareVersion: number
  locale: 'en' | 'zh-HK'
  versionId: string
  versionNumber: number
  publishedVersionNumber: number | null
  publishedLocale: 'en' | 'zh-HK' | null
  publishedAt: string | null
  signedUrl: string | null
  canPublish: boolean
}
const draft: Row = {
  reportId: 'r1', month: '2026-11', status: 'draft', publicSlug: 's'.repeat(32),
  shareVersion: 1, locale: 'en', versionId: 'v1', versionNumber: 1,
  publishedVersionNumber: null, publishedLocale: null, publishedAt: null,
  signedUrl: null, canPublish: true,
}
const published: Row = {
  ...draft, reportId: 'r2', status: 'published', shareVersion: 2,
  publishedVersionNumber: 1, publishedLocale: 'en', publishedAt: '2026-12-04T02:00:00.000Z',
  signedUrl: '/signed/slug?v=2',
}

function mount(rows: Row[]) {
  const render = () => {
    hooks.cursor = 0
    // Call the component directly, as the other hook-mocked tests do: a JSX
    // element would only be traversed as an opaque node by `nodes`.
    return MonthlyReportsList({ lang: 'en', clientId: CLIENT, rows })
  }
  const html = () => renderToStaticMarkup(<>{render()}</>)
  const button = (label: string) => nodes(render()).find(node =>
    node.type === 'button' && typeof node.props.onClick === 'function'
    && renderToStaticMarkup(<>{node.props.children}</>).includes(label))
  return {
    html,
    has(label: string) {
      return button(label) !== undefined
    },
    async click(label: string) {
      const target = button(label)
      expect(target).toBeDefined()
      target!.props.onClick!()
      // The handler is async; let it settle before reading the re-render.
      await new Promise(resolve => setTimeout(resolve, 0))
    },
  }
}

beforeEach(() => {
  hooks.slots = []
  hooks.cursor = 0
  hooks.refresh.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})

it('publishes the version the list shows and re-reads the server-rendered row', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
  const view = mount([draft])
  await view.click('monthly_publish')
  expect(fetch).toHaveBeenCalledWith(`/api/clients/${CLIENT}/months/2026-11/report/publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId: 'v1' }),
  })
  expect(hooks.refresh).toHaveBeenCalled()
  expect(view.html()).not.toContain('monthly_action_failed')
})

it('stops sharing without a body and re-reads the row', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
  const view = mount([published])
  await view.click('monthly_revoke')
  expect(fetch).toHaveBeenCalledWith(`/api/clients/${CLIENT}/months/2026-11/report/revoke`, { method: 'POST' })
  expect(hooks.refresh).toHaveBeenCalled()
})

it('does not claim success on a refused action and leaves the row re-tryable', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ error: 'MONTHLY_REPORT_UNAVAILABLE' }) } as Response)
  const view = mount([draft])
  await view.click('monthly_publish')
  expect(view.html()).toContain('monthly_action_failed')
  expect(view.html()).not.toContain('aria-busy="true"')
  expect(hooks.refresh).not.toHaveBeenCalled()
  // A second attempt is still offered.
  expect(view.has('monthly_publish')).toBe(true)
})

it('shows a busy label and disables both actions while a request is in flight', async () => {
  let resolve!: (value: Response) => void
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done }))
  const view = mount([draft, published])
  // Trigger without awaiting: the pending request keeps the busy state on screen.
  const click = view.click('monthly_publish')
  expect(view.html()).toContain('monthly_publishing')
  expect(view.html()).toContain('disabled=""')
  resolve({ ok: true, json: async () => ({}) } as Response)
  await click
  expect(hooks.refresh).toHaveBeenCalled()
})
