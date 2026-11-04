import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ profile: null as null | Record<string, unknown>, rows: [] as Record<string, unknown>[][], queries: [] as string[], fail: false }))
vi.mock('server-only', () => ({}))
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NOT_FOUND') },
  redirect: (to: string) => { throw new Error(`REDIRECT:${to}`) },
}))
vi.mock('@/lib/auth', () => ({ requireAuth: async () => m.profile }))
vi.mock('@/lib/flags', () => ({ isFeatureEnabled: () => true }))
vi.mock('@/lib/db', () => ({
  db: () => async (strings: TemplateStringsArray) => { if (m.fail) throw new Error('db down'); m.queries.push(strings.join('?')); return m.rows.shift() ?? [] },
}))

import { auditStudioStaffOpen, requireStudioBrand } from '@/lib/conversation-studio/secondary'

const own = '10000000-0000-4000-8000-000000000001'
const other = '10000000-0000-4000-8000-000000000002'
const brand = '30000000-0000-4000-8000-000000000001'

beforeEach(() => { m.rows = []; m.queries = [] })

describe('requireStudioBrand', () => {
  it('opens a brand of the signed-in account as an ordinary view', async () => {
    m.profile = { id: 'p', account_id: own, is_admin: false }
    m.rows = [[{ id: brand, brand_name: 'Bakery' }]]
    await expect(requireStudioBrand('en', brand, { allowStaff: true })).resolves.toMatchObject({ staff: false, accountId: own, brand: { name: 'Bakery' } })
    expect(m.queries).toHaveLength(1)
  })

  it('gives a non-admin the same 404 for another account’s brand as for a missing one, without looking it up', async () => {
    m.profile = { id: 'p', account_id: own, is_admin: false }
    m.rows = [[]]
    await expect(requireStudioBrand('en', brand, { allowStaff: true })).rejects.toThrow('NOT_FOUND')
    expect(m.queries).toHaveLength(1) // never reads across accounts
  })

  it('lets a platform admin open another account’s brand only under that account’s live grant, scoped to it', async () => {
    m.profile = { id: 'admin', account_id: own, is_admin: true }
    m.rows = [[], [{ id: brand, brand_name: 'Client', account_id: other }]]
    await expect(requireStudioBrand('en', brand, { allowStaff: true })).resolves.toMatchObject({ staff: true, accountId: other, brand: { name: 'Client' } })
    expect(m.queries[1]).toMatch(/join studio_staff_grants g on g\.account_id = c\.account_id/)
    expect(m.queries[1]).toMatch(/g\.revoked_at is null and g\.expires_at > now\(\)/)
  })

  it('gives an admin without a live grant the same 404 as a missing brand', async () => {
    m.profile = { id: 'admin', account_id: own, is_admin: true }
    m.rows = [[], []]
    await expect(requireStudioBrand('en', brand, { allowStaff: true })).rejects.toThrow('NOT_FOUND')
  })

  it('never grants a staff view where the page did not ask for one, or for a brand that does not exist', async () => {
    m.profile = { id: 'admin', account_id: own, is_admin: true }
    m.rows = [[]]
    await expect(requireStudioBrand('en', brand)).rejects.toThrow('NOT_FOUND')
    m.rows = [[], []]
    await expect(requireStudioBrand('en', brand, { allowStaff: true })).rejects.toThrow('NOT_FOUND')
  })

  it('records each open in the client account’s audit, plus one structured log line', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    await auditStudioStaffOpen({ actorId: 'admin', accountId: other, clientId: brand })
    expect(JSON.parse(String(spy.mock.calls[0]![0]))).toMatchObject({ event: 'studio_staff_open', actor: 'admin', account: other, client: brand })
    expect(m.queries).toHaveLength(1)
    expect(m.queries[0]).toMatch(/insert into studio_staff_audit/)
    spy.mockRestore()
  })

  it('fails closed: a staff open that could not be recorded does not render', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    m.fail = true
    await expect(auditStudioStaffOpen({ actorId: 'admin', accountId: other, clientId: brand })).rejects.toThrow('db down')
    m.fail = false
    spy.mockRestore()
  })

})
