import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommercialAccount } from '@/lib/tier'
const state = vi.hoisted(() => ({ calls: [] as { text: string; values: unknown[] }[], failure: '', count: 3 as unknown, clients: [{ id: 'active-a', brand_name: 'Acme', domain: 'example.com', industry: 'technology', status: 'active', account_id: 'DO_NOT_EXPOSE' }], pulse: [] as Record<string, unknown>[] }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('?'); state.calls.push({ text, values })
  if (state.failure && text.includes(state.failure)) throw new Error('Offline')
  if (text.includes('with owned_clients')) return state.pulse
  if (text.includes('count(*)')) return [{ n: state.count }]
  if (text.includes('from clients')) return values[0] === 'account-a' ? state.clients : []
  if (text.includes('from scans')) return [{ id: 'scan-a', domain: 'example.com', score: '42', grade: 'D', created_at: new Date('2026-09-06T01:00:00Z'), account_id: 'DO_NOT_EXPOSE' }]
  throw new Error('Unexpected query')
} }))
import { loadOwnedPortfolio } from '@/lib/workspace/load-owned-portfolio'
import { buildPortfolio } from '@/lib/view-models/portfolio'
const load = (accounts: CommercialAccount = { plan: 'pro', status: 'active', stripe_subscription_id: 'sub' }) => loadOwnedPortfolio({ profile: { account_id: 'account-a', accounts } })
const observation = { client_id: 'active-a', scan_week: '2026-09-01', platform: null, total_queries: 2, observed_queries: 2, successful_queries: 2, brand_mentions: 0, observed_brand_mentions: 0, sov_score: 0, successful_platform_count: 1 }
beforeEach(() => { state.calls = []; state.failure = ''; state.count = 3; state.clients = [{ id: 'active-a', brand_name: 'Acme', domain: 'example.com', industry: 'technology', status: 'active', account_id: 'DO_NOT_EXPOSE' }]; state.pulse = [] })

describe('owned portfolio read model', () => {
  it('binds authenticated tenant to each read and never mutates', async () => {
    await load()
    expect(state.calls).toHaveLength(4)
    for (const call of state.calls) {
      expect(call.values).toContain('account-a')
      expect(call.text).toContain('account_id')
      expect(call.text).not.toMatch(/\b(insert|update|delete)\b/i)
    }
    expect(state.calls[0].text).toContain("status = 'active'")
    expect(state.calls[0].values).toEqual(['account-a'])
  })
  it('does not expose clients for a mismatching bound account', async () => {
    const dto = buildPortfolio(await loadOwnedPortfolio({ profile: { account_id: 'different', accounts: null } }))
    expect(dto.clients).toEqual([])
    expect(state.calls.some(call => call.text.includes('with owned_clients'))).toBe(false)
  })
  it('stops after an authoritative active-client lookup failure', async () => {
    state.failure = 'from clients'
    await expect(load()).rejects.toThrow('Offline')
    expect(state.calls).toHaveLength(1)
  })
  it('matches all-owned-client capacity, including inactive clients', async () => {
    const dto = buildPortfolio(await load())
    expect(dto.clients).toHaveLength(1)
    expect(dto.capacity).toMatchObject({ state: 'known', count: 3, limit: 3, canCreate: false, plan: 'pro' })
    expect(state.calls.find(call => call.text.includes('count(*)'))!.text).not.toContain('status')
  })
  it.each([null, undefined, -1, 'unknown'])('keeps invalid count %s unavailable instead of zero', async count => {
    state.count = count
    expect(buildPortfolio(await load()).capacity).toMatchObject({ state: 'unknown', count: null, canCreate: null })
  })
  it('keeps optional count/history/Pulse failures independent', async () => {
    state.failure = 'select count(*)::int as n'
    expect(buildPortfolio(await load()).capacity.state).toBe('unknown')
    state.failure = 'from scans'
    let dto = buildPortfolio(await load())
    expect(dto.history.state).toBe('error'); expect(dto.clients[0].visibility.state).toBe('empty')
    state.failure = 'with owned_clients'
    dto = buildPortfolio(await load())
    expect(dto.clients[0].visibility.state).toBe('error'); expect(dto.history.state).toBe('ready')
  })
  it('uses existing entitlement override and cancellation limits', async () => {
    expect(buildPortfolio(await load({ plan: 'enterprise', status: 'cancelled' })).capacity.limit).toBe(1)
    expect(buildPortfolio(await load({ plan: 'free', override_plan: 'enterprise' })).capacity.limit).toBe(10)
  })
  it('normalizes persisted history numbers and timestamps and strips account fields', async () => {
    const dto = buildPortfolio(await load())
    expect(dto.history.data?.[0]).toEqual({ id: 'scan-a', domain: 'example.com', score: 42, grade: 'D', created_at: '2026-09-06T01:00:00.000Z' })
    expect(JSON.stringify(dto)).not.toContain('DO_NOT_EXPOSE')
    expect(state.calls.find(call => call.text.includes('from scans'))!.text).toMatch(/order by created_at desc, id desc limit 10/)
  })
  it('batches Pulse across clients without query growth or agent reads', async () => {
    state.clients = Array.from({ length: 30 }, (_, i) => ({ ...state.clients[0], id: `active-${i}` }))
    await load()
    expect(state.calls).toHaveLength(4)
    expect(state.calls.some(call => call.text.includes('agent_'))).toBe(false)
    const pulse = state.calls.find(call => call.text.includes('with owned_clients'))!
    expect(pulse.values).toContainEqual(state.clients.map(client => client.id))
    expect(pulse.text).toContain('max(scan_week)')
    expect(pulse.text).toContain('union')
  })
  it('keeps latest observations isolated per owned client and excludes foreign rows', async () => {
    state.clients.push({ ...state.clients[0], id: 'active-b', brand_name: 'Second' })
    state.pulse = [observation,
      { client_id: 'active-a', scan_week: '2026-09-08', platform: null, total_queries: null },
      { ...observation, client_id: 'active-b', scan_week: '2026-08-25', brand_mentions: 2, observed_brand_mentions: 2, sov_score: 100, raw_answer: 'PRIVATE RAW TEXT' },
      { ...observation, client_id: 'foreign', scan_week: '2099-01-01', brand_mentions: 2, observed_brand_mentions: 2, sov_score: 100 },
    ]
    const dto = buildPortfolio(await load())
    expect(dto.clients.map(client => client.id)).toEqual(['active-a', 'active-b'])
    expect(dto.clients[0].visibility).toMatchObject({ state: 'empty', observedAt: '2026-09-08' })
    expect(dto.clients[1].visibility).toMatchObject({ state: 'ready', observedAt: '2026-08-25', data: { sovScore: 100 } })
    expect(JSON.stringify(dto)).not.toMatch(/foreign|2099|PRIVATE RAW TEXT|raw_answer/)
    const query = state.calls.find(call => call.text.includes('with owned_clients'))!.text
    expect(query).toContain('max(scan_week) as scan_week from weeks group by client_id')
    expect(query).toContain('w.client_id = m.client_id and w.scan_week = m.scan_week')
    expect(query).toContain('group by m.client_id, m.scan_week')
  })
  it('preserves genuine zero visibility with a usable observed denominator', async () => {
    state.pulse = [observation]
    const visibility = buildPortfolio(await load()).clients[0].visibility
    expect(visibility.state).toBe('ready')
    expect(visibility.data?.sovScore).toBe(0)
    expect(visibility.observedAt).toBe('2026-09-01')
    expect(visibility.freshness).toBe('unknown')
  })
  it('does not fall back to an older aggregate for a newer raw-only week', async () => {
    state.pulse = [observation, { client_id: 'active-a', scan_week: '2026-09-08', platform: null, total_queries: null }]
    const visibility = buildPortfolio(await load()).clients[0].visibility
    expect(visibility.state).toBe('empty'); expect(visibility.observedAt).toBe('2026-09-08')
  })
  it.each([{ successful_queries: 0 }, { successful_queries: null }, { observed_brand_mentions: 1 }, { total_queries: 0 }])('shares conservative C8a invalid-observation rule %j', async invalid => {
    state.pulse = [{ ...observation, ...invalid }]
    expect(buildPortfolio(await load()).clients[0].visibility.state).toBe('empty')
    expect(state.calls.find(call => call.text.includes('with owned_clients'))!.text).toContain("raw_answer ~ '[^[:space:]]'")
  })
})
