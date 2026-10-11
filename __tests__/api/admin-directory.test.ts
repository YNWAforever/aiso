import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const { profile, sql } = vi.hoisted(() => ({ profile: vi.fn(), sql: vi.fn() }))
vi.mock('@/lib/auth', () => ({ getProfile: profile }))
vi.mock('@/lib/db', () => ({ db: () => sql }))
const account = '11111111-1111-4111-8111-111111111111'
async function get(query = '') {
  const { GET } = await import('@/app/api/admin/directory/route')
  return GET(new NextRequest('http://localhost/api/admin/directory' + query))
}
beforeEach(() => { vi.clearAllMocks(); profile.mockResolvedValue({ id: 'admin', account_id: account, is_admin: true }); sql.mockResolvedValue([]) })
describe('platform directory', () => {
  it.each([null, { id: 'tenant', is_admin: false }])('does not query any account data for unauthorized sessions', async user => {
    profile.mockResolvedValue(user); expect((await get()).status).toBe(user ? 403 : 401); expect(sql).not.toHaveBeenCalled()
  })
  it.each(['?view=secrets', '?page=0', '?page=1.5', '?accountId=bad', '?q=' + 'x'.repeat(121)])('rejects invalid directory query %s', async query => { expect((await get(query)).status).toBe(400); expect(sql).not.toHaveBeenCalled() })
  it('bounds each page and reports more rows without leaking an extra row', async () => {
    sql.mockResolvedValue(Array.from({ length: 26 }, (_, i) => ({ id: String(i), account_id: account, display_name: 'User ' + i })))
    const response = await get('?view=users&page=2'); const body = await response.json()
    expect(body.rows).toHaveLength(25); expect(body.hasMore).toBe(true); expect(body.page).toBe(2)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(sql.mock.calls[0].slice(1)).toContain(25)
  })
  it.each(['users','accounts','brands','scans','prompts','observations','runs','sources','work'])('keeps %s account drilldowns parameterized and scoped', async view => {
    const response = await get(`?view=${view}&accountId=${account}&q=needle`)
    expect(response.status).toBe(200)
    const call = sql.mock.calls[0]; expect(call.slice(1)).toContain(account)
    expect(call[0].join(' ')).not.toContain(account)
    expect(call[0].join(' ')).toMatch(/account_id|a\.id/)
  })
  it('shows a dataset outage as unavailable rather than an empty successful directory', async () => {
    sql.mockRejectedValue(new Error('database password=secret')); const response = await get('?view=runs')
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('secret')
  })
})
