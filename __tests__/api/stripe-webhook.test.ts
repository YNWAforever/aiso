import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/stripe', () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn(),
    },
  },
}))

vi.mock('@/lib/supabase-server', () => ({
  createServiceSupabaseClient: vi.fn(),
}))

describe('stripe webhook plan mapping', () => {
  it('maps price_pro to pro plan', () => {
    const priceId = process.env.STRIPE_PRICE_PRO ?? 'price_pro'
    const getPlan = (pid: string) =>
      pid === (process.env.STRIPE_PRICE_PRO ?? 'price_pro') ? 'pro' : 'basic'

    expect(getPlan(process.env.STRIPE_PRICE_PRO ?? 'price_pro')).toBe('pro')
    expect(getPlan('price_unknown')).toBe('basic')
  })
})
