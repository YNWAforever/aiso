import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { NotificationBell } from '@/components/dashboard/NotificationBell'

const hooks = vi.hoisted(() => ({ slots: [] as unknown[], cursor: 0, refresh: vi.fn() }))
vi.mock('react', async importOriginal => ({
  ...await importOriginal<typeof import('react')>(),
  useState(initial: unknown) {
    const index = hooks.cursor++
    if (!(index in hooks.slots)) hooks.slots[index] = initial
    return [hooks.slots[index], (next: unknown) => {
      hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next
    }]
  },
  useEffect: () => undefined,
  useRef: () => ({ current: null }),
  useId: () => 'notifications-test',
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: hooks.refresh }) }))

type Element = ReactElement<{ children?: ReactNode; onClick?: () => Promise<void>; 'aria-controls'?: string }>
function elements(node: ReactNode): Element[] {
  return Children.toArray(node).flatMap(child => isValidElement(child)
    ? [child as Element, ...elements((child as Element).props.children)] : [])
}
function mount(initialCount: number | null, lang = 'en') {
  const render = () => { hooks.cursor = 0; return NotificationBell({ initialCount, lang }) }
  return {
    html: () => renderToStaticMarkup(render()),
    async click(label?: string) {
      const button = elements(render()).find(node => node.type === 'button' && (label
        ? renderToStaticMarkup(<>{node.props.children}</>).includes(label)
        : node.props['aria-controls']))
      expect(button, `button ${label ?? 'trigger'} exists`).toBeDefined()
      await button!.props.onClick!()
    },
  }
}
const item = (id = 'n1') => ({ id, title: 'Observed alert', message: 'Brand mentions changed', read: false, type: 'sov_threshold', created_at: '2026-09-06T00:00:00Z' })
const response = (ok: boolean, notifications: unknown[] = []) => ({ ok, json: async () => ({ notifications }) })

beforeEach(() => {
  hooks.slots = []; hooks.cursor = 0; hooks.refresh.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})

describe('notification bell read and write states', () => {
  it('keeps failed GET distinct from empty and retries successfully', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(false) as Response).mockResolvedValueOnce(response(true, [item()]) as Response)
    const bell = mount(2)
    await bell.click()
    expect(bell.html()).toContain('Notifications could not be loaded.')
    expect(bell.html()).not.toContain('No notifications yet.')
    await bell.click('Retry')
    expect(bell.html()).toContain('Observed alert')
    expect(bell.html()).not.toContain('Notifications could not be loaded.')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
  it('does not infer the global unknown unread count from the latest 20 rows', async () => {
    vi.mocked(fetch).mockResolvedValue(response(true, Array.from({ length: 20 }, (_, i) => item(String(i)))) as Response)
    const bell = mount(null)
    await bell.click()
    expect(bell.html()).toContain('Unread count unavailable')
    expect(bell.html()).not.toContain('9+')
    expect(hooks.refresh).toHaveBeenCalledOnce()
    expect(bell.html()).toContain('Observed alert')
  })
  it('does not infer a known global count from an empty latest-page response', async () => {
    vi.mocked(fetch).mockResolvedValue(response(true) as Response)
    const bell = mount(7)
    await bell.click()
    expect(bell.html()).toContain('No notifications yet.')
    expect(bell.html()).toContain('>7</span>')
  })
  it('preserves unread state and skips refresh when PUT fails', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response(true, [item()]) as Response).mockResolvedValueOnce(response(false) as Response)
    const bell = mount(1)
    await bell.click(); await bell.click('Mark all read')
    expect(bell.html()).toContain('Notifications could not be marked as read.')
    expect(bell.html()).toContain('bg-primary/10')
    expect(bell.html()).toContain('>1</span>')
    expect(hooks.refresh).not.toHaveBeenCalled()
  })
  it('clears unread state and refreshes only after a successful PUT', async () => {
    vi.mocked(fetch).mockResolvedValue(response(true, [item()]) as Response)
    const bell = mount(null)
    await bell.click()
    expect(hooks.refresh).toHaveBeenCalledOnce()
    hooks.refresh.mockClear()
    await bell.click('Mark all read')
    expect(fetch).toHaveBeenLastCalledWith('/api/notifications/read-all', { method: 'PUT' })
    expect(bell.html()).not.toContain('Unread count unavailable')
    expect(bell.html()).not.toContain('bg-primary/10')
    expect(bell.html()).not.toContain('Mark all read')
    expect(hooks.refresh).toHaveBeenCalledOnce()
  })
  it('localizes unknown counts and lookup failures', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('offline'))
    const bell = mount(null, 'zh-HK')
    await bell.click()
    expect(bell.html()).toContain('未讀數量暫時無法取得')
    expect(bell.html()).toContain('暫時無法載入通知。')
    expect(bell.html()).toContain('重試')
    expect(bell.html()).not.toContain('暫時沒有通知。')
  })
})

it('blocks mark-all-read until the pending GET settles', async () => {
  let finish!: (value: Response) => void
  vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve }))
  const bell = mount(3)
  const loading = bell.click()
  expect(bell.html()).toMatch(/<button[^>]*disabled=""[^>]*>Mark all read/)
  // The handler also guards against stale/programmatic invocation while loading.
  await bell.click('Mark all read')
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(hooks.refresh).not.toHaveBeenCalled()
  finish(response(true, [item()]) as Response)
  await loading
  expect(bell.html()).not.toMatch(/<button[^>]*disabled=""[^>]*>Mark all read/)
  expect(bell.html()).toContain('bg-primary/10')
})
