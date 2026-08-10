import { NextRequest } from 'next/server'
import { beforeEach, expect, test, vi } from 'vitest'
import { getPlanFeatures, maxBrandsForPlan } from '@/lib/tier'

const h = vi.hoisted(() => {
  const state = {
    getProfile: vi.fn(),
    count: 0,
    inserts: [] as Array<Record<string, unknown>>,
    sql: vi.fn(),
  }

  state.sql.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = Array.from(strings).join(' ')
    if (/select count\(\*\)::int as n/i.test(query)) return Promise.resolve([{ n: state.count }])
    if (/insert into clients/i.test(query)) {
      state.inserts.push({ query, values })
      return Promise.resolve([{ id: 'client-created' }])
    }
    return Promise.resolve([])
  })

  return state
})

vi.mock('@/lib/auth', () => ({ getProfile: h.getProfile }))
vi.mock('@/lib/db', () => ({ db: () => h.sql }))

beforeEach(() => {
  h.count = 0
  h.inserts.length = 0
  h.sql.mockClear()
  h.getProfile.mockResolvedValue({
    account_id: 'account-1',
    accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_pro' },
  })
})

test('pro plan allows 3 brands', () => {
  expect(getPlanFeatures('pro').max_brands).toBe(3)
})

test('basic plan allows 1 brand', () => {
  expect(getPlanFeatures('basic').max_brands).toBe(1)
})

test('maxBrandsForPlan returns correct limits', () => {
  expect(maxBrandsForPlan('basic')).toBe(1)
  expect(maxBrandsForPlan('pro')).toBe(3)
  expect(maxBrandsForPlan('enterprise')).toBe(10)
})

test('allows a brand at limit-minus-one and rejects limit and limit-plus-one quota counts', async () => {
  const { POST } = await import('@/app/api/dashboard/clients/route')
  const limit = maxBrandsForPlan('pro')
  const request = () => new NextRequest('http://localhost/api/dashboard/clients', {
    method: 'POST',
    body: JSON.stringify({ brand_name: 'Boundary Brand' }),
    headers: { 'content-type': 'application/json' },
  })

  h.count = limit - 1
  await expect(POST(request())).resolves.toMatchObject({ status: 200 })
  expect(h.inserts).toHaveLength(1)

  h.count = limit
  await expect(POST(request())).resolves.toMatchObject({ status: 403 })

  h.count = limit + 1
  await expect(POST(request())).resolves.toMatchObject({ status: 403 })
})
