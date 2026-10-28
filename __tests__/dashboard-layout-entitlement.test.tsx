import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const dbNextResults = vi.hoisted((): unknown[] => [])
const { requireAuthMock, headersMock, dbMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  headersMock: vi.fn(),
  dbMock: vi.fn(() => {
    const result = dbNextResults.shift()
    if (result instanceof Error) throw result
    return Promise.resolve(result ?? [])
  }),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }))
vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('@/lib/db', () => ({ db: () => dbMock }))
vi.mock('@/components/dashboard/DashboardSidebar', () => ({
  DashboardSidebar: () => null,
}))
vi.mock('@/components/dashboard/TrialBanner', () => ({
  TrialBanner: () => null,
}))
vi.mock('@/components/dashboard/shell/TopBar', () => ({
  TopBar: () => null,
}))
vi.mock('server-only', () => ({}))

import DashboardLayout from '@/app/[lang]/dashboard/layout'
import { TrialBanner } from '@/components/dashboard/TrialBanner'
import { TopBar } from '@/components/dashboard/shell/TopBar'
import { DashboardSidebar } from '@/components/dashboard/DashboardSidebar'

afterEach(() => vi.unstubAllEnvs())
it.each([undefined, 'true', '1'])('passes the server studio flag %s to both navigation consumers', async value => {
  vi.stubEnv('FEATURE_CONVERSATION_STUDIO', value)
  headersMock.mockResolvedValue(new Headers())
  const layout = await renderLayout(account())
  for (const type of [TopBar, DashboardSidebar]) {
    expect(findElementOfType<{ conversationStudio: boolean }>(layout, type)?.props.conversationStudio).toBe(value === '1')
  }
})

type TrialBannerProps = {
  daysRemaining: number
  lang: string
}

function account(overrides: Record<string, unknown> = {}) {
  return {
    plan: 'basic',
    status: 'active',
    stripe_subscription_id: null,
    trial_ends_at: null,
    ...overrides,
  }
}

function findElementOfType<P>(node: ReactNode, type: unknown): ReactElement<P> | undefined {
  if (!isValidElement(node)) return undefined
  if (node.type === type) return node as ReactElement<P>

  const props = node.props as { children?: ReactNode }
  for (const child of Children.toArray(props.children)) {
    const found = findElementOfType<P>(child, type)
    if (found) return found
  }
  return undefined
}

async function renderLayout(accounts: Record<string, unknown>) {
  requireAuthMock.mockResolvedValue({ account_id: 'account-1', accounts })
  return DashboardLayout({
    children: <main>Dashboard</main>,
    params: Promise.resolve({ lang: 'en' }),
  })
}

describe('dashboard trial banner entitlement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    headersMock.mockResolvedValue(new Headers())
    dbNextResults.length = 0
  })

  it('renders for a live trial entitlement', async () => {
    const layout = await renderLayout(account({
      trial_ends_at: '2999-01-08T00:00:00.000Z',
    }))

    const banner = findElementOfType<TrialBannerProps>(layout, TrialBanner)
    expect(banner).toBeDefined()
    expect(banner?.props.lang).toBe('en')
    expect(banner?.props.daysRemaining).toBeGreaterThan(0)
  })

  it.each([
    ['active paid with a stale future trial', account({
      plan: 'pro',
      stripe_subscription_id: 'sub_paid',
      trial_ends_at: '2999-01-08T00:00:00.000Z',
    })],
    ['past due with a future trial date', account({
      status: 'past_due',
      stripe_subscription_id: 'sub_stale',
      trial_ends_at: '2999-01-08T00:00:00.000Z',
    })],
    ['cancelled with a future trial date', account({
      status: 'cancelled',
      stripe_subscription_id: 'sub_stale',
      trial_ends_at: '2999-01-08T00:00:00.000Z',
    })],
    ['expired trial', account({
      trial_ends_at: '2000-01-01T00:00:00.000Z',
    })],
    ['malformed trial date', account({
      trial_ends_at: 'not-a-date',
    })],
    ['free account with a future trial date', account({
      plan: 'free',
      trial_ends_at: '2999-01-08T00:00:00.000Z',
    })],
  ])('does not render for %s', async (_case, accounts) => {
    const layout = await renderLayout(accounts)

    expect(findElementOfType<TrialBannerProps>(layout, TrialBanner)).toBeUndefined()
  })
})

describe('dashboard notification bell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    headersMock.mockResolvedValue(new Headers())
    dbNextResults.length = 0
  })

  // The bell lives in the top bar now (Phase 4); the layout still owns the count.
  type TopBarProps = { unreadCount: number | null; brands: { id: string; name: string }[] | null }

  it('passes the unread count and the brands to the top bar', async () => {
    dbNextResults.push([{ n: 3 }], [{ id: 'c1', brand_name: 'Acme', domain: 'acme.test' }])

    const layout = await renderLayout(account())
    const bar = findElementOfType<TopBarProps>(layout, TopBar)

    expect(bar?.props.unreadCount).toBe(3)
    expect(bar?.props.brands).toEqual([{ id: 'c1', name: 'Acme', domain: 'acme.test' }])
  })

  it('preserves an unknown count and unknown brands without failing the page', async () => {
    dbNextResults.push(new Error('connection terminated'), new Error('connection terminated'))

    const layout = await renderLayout(account())
    const bar = findElementOfType<TopBarProps>(layout, TopBar)

    expect(bar).toBeDefined()
    expect(bar?.props.unreadCount).toBeNull()
    expect(bar?.props.brands).toBeNull()
  })
})
