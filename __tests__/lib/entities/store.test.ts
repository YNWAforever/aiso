import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({ sql: vi.fn(), transaction: vi.fn() }))
vi.mock('@/lib/db', () => ({db: () => Object.assign(h.sql,{transaction:h.transaction})}))
import { loadEntity, saveEntity } from '@/lib/entities/store'
const input = {displayName:'Brand',aliases:['Alias'],expectedRevision:0}
const row = {client_id:'client',display_name:'Brand',aliases:['Alias'],revision:1,updated_at:'2026-09-06T00:00:00Z',account_id:'secret',updated_by:'secret'}
const query = (i: number) => (h.sql.mock.calls[i][0] as string[]).join('?').replace(/\s+/g,' ')
describe('account-scoped entity SQL', () => {
  beforeEach(() => {vi.resetAllMocks(); h.sql.mockReturnValue([])})
  it('reads only an owned entity and drops private metadata', async () => {h.sql.mockResolvedValue([row]); expect(await loadEntity('account','client')).toEqual({clientId:'client',displayName:'Brand',aliases:['Alias'],revision:1,updatedAt:row.updated_at,verification:'unverified'}); expect(query(0)).toContain('join clients'); expect(h.sql.mock.calls[0]).toContain('account')})
  it('creates atomically from owned client, and reads after conflict in the transaction', async () => {h.transaction.mockResolvedValue([[row],[]]); expect((await saveEntity('account','client','actor',input))?.revision).toBe(1); expect(query(0)).toMatch(/insert into client_entities.*select.*from clients.*account_id.*on conflict.*do nothing/i); expect(h.transaction).toHaveBeenCalledOnce()})
  it('accepts a same normalized stale retry without mutating it again', async () => {h.transaction.mockResolvedValue([[],[row]]); expect((await saveEntity('account','client','actor',input))?.revision).toBe(1); expect(query(1)).toContain('e.revision >'); expect(query(1)).toContain('e.display_name ='); expect(query(1)).toContain('e.aliases =')})
  it('updates with account, ownership, revision guard and atomic increment', async () => {h.transaction.mockResolvedValue([[{...row,revision:2}],[]]); expect((await saveEntity('account','client','actor',{...input,expectedRevision:1}))?.revision).toBe(2); expect(query(0)).toContain('revision = e.revision + 1'); expect(query(0)).toContain('e.revision ='); expect(query(0)).toContain('exists'); expect(query(0)).toContain('c.account_id = e.account_id')})
  it('never creates on a future revision or falsely succeeds on stale conflict', async () => {h.transaction.mockResolvedValue([[],[]]); expect(await saveEntity('account','client','actor',{...input,expectedRevision:4})).toBeNull(); expect(query(0)).not.toContain('insert into')})
  it('propagates transaction failure', async () => {h.transaction.mockRejectedValue(new Error('failure')); await expect(saveEntity('account','client','actor',input)).rejects.toThrow('failure')})
})
