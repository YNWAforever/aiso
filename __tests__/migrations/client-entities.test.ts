import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const path = 'supabase/migrations/040_client_entities.sql'
describe('private entity migration contract (not execution)', () => {
  it('constrains owned client, same-account actor and row content', () => {
    const sql = readFileSync(path,'utf8').toLowerCase().replace(/\s+/g,' ')
    expect(sql).toContain('foreign key (client_id, account_id) references public.clients (id, account_id)')
    expect(sql).toContain('foreign key (updated_by, account_id) references public.profiles (id, account_id)')
    expect(sql).toContain('on delete set null (updated_by)')
    expect(sql).toContain('jsonb_array_length(aliases) <= 20')
    expect(sql).toContain('char_length(display_name) between 1 and 120')
    expect(sql).toContain('revision > 0')
  })
  it('removes inherited privileges and grants only required table operations', () => {
    const sql = readFileSync(path,'utf8').toLowerCase()
    expect(sql).toContain('revoke all on public.client_entities from public')
    expect(sql).toContain('revoke all on public.client_entities from aeo_app')
    expect(sql).toContain('grant select, insert, update on public.client_entities to aeo_app')
    expect(sql).not.toMatch(/create\s+(?:role|policy)/)
  })
})
