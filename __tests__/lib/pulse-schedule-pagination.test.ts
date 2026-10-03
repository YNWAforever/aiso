import { describe, expect, it, vi } from 'vitest'
import { selectPendingClients, selectPendingClientPage } from '@/lib/pulse/schedule'
import type { db } from '@/lib/db'

const candidate = (id: string, extra: Record<string, unknown> = {}) => ({
  client_id: id, created_at: '2026-10-01T00:00:00.000Z', prompt_count: 24, scanned_prompts: 0,
  plan: 'free', status: 'active', stripe_subscription_id: null, trial_ends_at: null,
  override_plan: 'pro', override_expires_at: '2020-01-01T00:00:00.000Z', ...extra,
})
describe('T06 eligibility candidate traversal', () => {
  it('retains PostgreSQL microseconds in the consumed keyset cursor',async()=>{
    const sql=vi.fn(async()=>[candidate('00000000-0000-4000-8000-000000000001',{created_at:'2026-10-01T00:00:00.123456Z',plan:'pro',stripe_subscription_id:'synthetic',override_plan:null})])
    expect((await selectPendingClientPage(sql as unknown as ReturnType<typeof db>,{limit:1,scanWeek:'2026-09-28',deadlineMs:Date.now()+5000})).nextCursor?.createdAt).toBe('2026-10-01T00:00:00.123456Z')
  })
  it('expired_oldest_does_not_starve_paid_client with limit=1', async () => {
    const rows = [candidate('00000000-0000-4000-8000-000000000001'), candidate('00000000-0000-4000-8000-000000000002', {
      plan: 'pro', stripe_subscription_id: 'synthetic_subscription', override_plan: null, override_expires_at: null,
    })]
    const sql = vi.fn(async (_strings: TemplateStringsArray, ...params: unknown[]) => rows.slice(0, Number(params.at(-1))))
    expect(await selectPendingClients(sql as unknown as ReturnType<typeof db>, 1)).toEqual([
      { clientId: rows[1].client_id, promptCount: 24, cursor: 0 },
    ])
  })
  it('crosses 101 invalid candidates before selecting a paid brand', async () => {
    const rows = Array.from({ length: 102 }, (_, index) => candidate(`00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      index === 101 ? { plan: 'pro', stripe_subscription_id: 'synthetic_subscription', override_plan: null } : {}))
    const sql = vi.fn(async (_strings: TemplateStringsArray, ...params: unknown[]) => {
      const cursorId = params.at(-2)
      const offset = cursorId ? rows.findIndex(row => row.client_id === cursorId) + 1 : 0
      return rows.slice(offset, offset + Number(params.at(-1)))
    })
    const page = await selectPendingClientPage(sql as unknown as ReturnType<typeof db>, { limit: 1, scanWeek: '2026-09-28', deadlineMs: Date.now() + 5000 })
    expect(page.items[0]?.clientId).toBe(rows[101].client_id)
    expect(page.scanned).toBe(102)
    expect(page.exhausted).toBe(true)
    expect(sql).toHaveBeenCalledTimes(2)
  })
  it('returns the last consumed cursor and exhausted=false at the deadline, then resumes', async () => {
    const sql = vi.fn(async () => Array.from({ length: 100 }, (_, i) => candidate(`00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`)))
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValue(10)
    try {
      const page = await selectPendingClientPage(sql as unknown as ReturnType<typeof db>, { limit: 1, scanWeek: '2026-09-28', deadlineMs: 5 })
      expect(page).toMatchObject({ items: [], exhausted: false, scanned: 1, nextCursor: { clientId: '00000000-0000-4000-8000-000000000001' } })
      now.mockRestore()
      const resumeSql = vi.fn(async () => [candidate('00000000-0000-4000-8000-000000000102', { plan: 'pro', stripe_subscription_id: 'synthetic_subscription', override_plan: null })])
      const resumed = await selectPendingClientPage(resumeSql as unknown as ReturnType<typeof db>, { limit: 1, after: page.nextCursor, scanWeek: '2026-09-28', deadlineMs: Date.now() + 5000 })
      expect(resumed.items).toHaveLength(1)
      expect(resumeSql.mock.calls[0]).toBeDefined()
    } finally { now.mockRestore() }
  })
})
