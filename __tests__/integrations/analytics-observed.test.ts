import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ loadAnalyticsBinding: vi.fn(), loadAnalyticsPanel: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/integrations/analytics/store', () => m)

import { loadObservedPanel } from '@/lib/integrations/analytics/observed'

const pro = { account_id: 'acct-1', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } }
const CLIENT = '11111111-1111-4111-8111-111111111111'
const binding = { keyEvents: ['generate_lead'], boundAt: '2026-09-01T00:00:00.000Z' }
const synced = {
  latest: null,
  lastGoodDataThrough: '2026-09-27',
  last28: { total: 3, bySource: { organic_search: 3, ai_assistant: 0, other: 0 }, byEvent: [{ eventName: 'generate_lead', count: 3 }] },
  owner: { leadValue: null, closeRate: null },
}
const load = (profile: Parameters<typeof loadObservedPanel>[0] = pro) => loadObservedPanel(profile, CLIENT)

describe('loadObservedPanel', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    process.env.FEATURE_ANALYTICS = '1'
    m.loadAnalyticsBinding.mockReset().mockResolvedValue(binding)
    m.loadAnalyticsPanel.mockReset().mockResolvedValue(synced)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    delete process.env.FEATURE_ANALYTICS
    vi.restoreAllMocks()
  })

  it('returns the panel for a Pro account with the flag on and a binding', async () => {
    expect(await load()).toBe(synced)
    expect(m.loadAnalyticsBinding).toHaveBeenCalledWith('acct-1', CLIENT)
    expect(m.loadAnalyticsPanel).toHaveBeenCalledWith('acct-1', CLIENT, binding.keyEvents, binding.boundAt)
  })

  it('touches nothing when the flag is off', async () => {
    delete process.env.FEATURE_ANALYTICS
    expect(await load()).toBeNull()
    expect(m.loadAnalyticsBinding).not.toHaveBeenCalled()
  })

  it('touches nothing below Pro', async () => {
    expect(await load({ ...pro, accounts: { ...pro.accounts, plan: 'basic' } })).toBeNull()
    expect(m.loadAnalyticsBinding).not.toHaveBeenCalled()
  })

  it('touches nothing for a cancelled Pro account, because entitlement reads status', async () => {
    expect(await load({ ...pro, accounts: { ...pro.accounts, status: 'cancelled' } })).toBeNull()
    expect(m.loadAnalyticsBinding).not.toHaveBeenCalled()
  })

  it('is null without a binding, and loads no panel', async () => {
    m.loadAnalyticsBinding.mockResolvedValue(null)
    expect(await load()).toBeNull()
    expect(m.loadAnalyticsPanel).not.toHaveBeenCalled()
  })

  it('is null before anything has synced, so the card never shows a false zero', async () => {
    m.loadAnalyticsPanel.mockResolvedValue({ ...synced, last28: null, lastGoodDataThrough: null })
    expect(await load()).toBeNull()
  })

  it('still shows a synced window that observed no enquiries', async () => {
    const empty = { ...synced, last28: null }
    m.loadAnalyticsPanel.mockResolvedValue(empty)
    expect(await load()).toBe(empty)
  })

  it('omits the card rather than throwing when the binding read fails, logging only the error name', async () => {
    const err = new Error('postgresql://user:secret@host/db')
    err.name = 'NeonDbError'
    m.loadAnalyticsBinding.mockRejectedValue(err)
    expect(await load()).toBeNull()
    const logged = JSON.stringify(errorSpy.mock.calls)
    expect(logged).toContain('NeonDbError')
    expect(logged).not.toContain('secret')
  })

  it('omits the card when the panel read fails', async () => {
    m.loadAnalyticsPanel.mockRejectedValue(new Error('boom'))
    expect(await load()).toBeNull()
    expect(errorSpy).toHaveBeenCalled()
  })
})

const repoRoot = process.cwd()
const read = (path: string) => readFileSync(join(repoRoot, path), 'utf8')
const LOCAL_TRUST_PROPS = ['actions', 'clientId', 'competitors', 'features', 'lang', 'profile', 'roiUnavailable', 'snapshot']

describe('the dashboard page composes the observed card beside Local Trust', () => {
  const page = read('app/[lang]/dashboard/[clientId]/page.tsx')
  const localTrustBlock = page.match(/<LocalTrustStep\b([\s\S]*?)\n\s*\/>/)?.[1] ?? ''
  const jsxProps = [...localTrustBlock.matchAll(/^\s{2,}(\w+)=/gm)].map(x => x[1]!).sort()

  it('leaves LocalTrustStep with exactly the props it had, none of them analytics', () => {
    expect(localTrustBlock.trim().length).toBeGreaterThan(0)
    expect(jsxProps).toEqual(LOCAL_TRUST_PROPS)
    expect(localTrustBlock).not.toMatch(/analytics|observed/i)
  })

  it('declares the same props on the component itself', () => {
    const src = read('components/dashboard/local-trust/LocalTrustStep.tsx')
    const type = src.match(/type Props = \{([\s\S]*?)\n\}/)?.[1] ?? ''
    const keys = [...type.matchAll(/^ {2}(\w+)\??:/gm)].map(x => x[1]!).sort()
    expect(keys).toEqual(LOCAL_TRUST_PROPS)
  })

  it('renders the card on the roi step from the loader, beside the scenario', () => {
    expect(page).toContain("import { ObservedEnquiriesCard } from '@/components/integrations/ObservedEnquiriesCard'")
    expect(page).toContain("step === 'roi' && observed && (")
    expect(page).toMatch(/<ObservedEnquiriesCard lang=\{lang\} clientId=\{clientId\} panel=\{observed\} \/>/)
  })

  it('loads analytics for the roi step only, through the gated loader with the session profile', () => {
    expect(page).toContain("step === 'roi' ? await loadObservedPanel(profile, clientId) : null")
    expect(page.match(/loadObservedPanel\(/g)).toHaveLength(1)
  })

  it('does not gate through the raw plan string', () => {
    expect(page).not.toContain('getPlanFeatures')
  })
})
