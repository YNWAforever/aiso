import { Children, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireAuthMock, headersMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  headersMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }))
vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('@/lib/db', () => ({ db: vi.fn(() => { throw new Error('unexpected db access') }) }))
vi.mock('@/components/dashboard/DashboardSidebar', () => ({
  DashboardSidebar: () => null,
}))
vi.mock('@/components/dashboard/TrialBanner', () => ({
  TrialBanner: () => null,
}))

import DashboardLayout from '@/app/[lang]/dashboard/layout'
import { TrialBanner } from '@/components/dashboard/TrialBanner'

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

function findTrialBanner(node: ReactNode): ReactElement<TrialBannerProps> | undefined {
  if (!isValidElement(node)) return undefined
  if (node.type === TrialBanner) return node as ReactElement<TrialBannerProps>

  const props = node.props as { children?: ReactNode }
  for (const child of Children.toArray(props.children)) {
    const banner = findTrialBanner(child)
    if (banner) return banner
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
  })

  it('renders for a live trial entitlement', async () => {
    const layout = await renderLayout(account({
      trial_ends_at: '2999-01-08T00:00:00.000Z',
    }))

    const banner = findTrialBanner(layout)
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

    expect(findTrialBanner(layout)).toBeUndefined()
  })
})
