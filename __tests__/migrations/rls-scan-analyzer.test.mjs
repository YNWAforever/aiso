import { describe, expect, it } from 'vitest'

import {
  findCreatedPolicies,
  findDisabledRlsTables,
  findDroppedPolicies,
} from '../helpers/migration-rls-scan.mjs'

describe('migration RLS scanner', () => {
  it('finds a created policy and normalises the schema prefix', () => {
    const sql = 'create policy "owner_all_notifications" on public.notifications for all using (true);'

    expect(findCreatedPolicies(sql)).toEqual(['notifications.owner_all_notifications'])
  })

  it('treats a bare table name as the same table as a qualified one', () => {
    const bare = findCreatedPolicies('create policy "p" on clients for all using (true);')
    const qualified = findCreatedPolicies('create policy "p" on public.clients for all using (true);')

    expect(bare).toEqual(qualified)
    expect(bare).toEqual(['clients.p'])
  })

  it('ignores statements inside line comments', () => {
    const sql = '-- create policy "ghost" on public.scans for select using (true);\nselect 1;'

    expect(findCreatedPolicies(sql)).toEqual([])
  })

  it('is case-insensitive and tolerates newlines inside the statement', () => {
    const sql = 'CREATE POLICY "users see own account"\n  ON accounts\n  FOR ALL USING (true);'

    expect(findCreatedPolicies(sql)).toEqual(['accounts.users see own account'])
  })

  it('finds drop policy if exists statements', () => {
    const sql = 'drop policy if exists "users see own clients" on public.clients;'

    expect(findDroppedPolicies(sql)).toEqual(['clients.users see own clients'])
  })

  it('does not report a drop as a create', () => {
    expect(findCreatedPolicies('drop policy if exists "p" on public.scans;')).toEqual([])
  })

  it('does not report a create as a drop', () => {
    expect(findDroppedPolicies('create policy "p" on public.scans for all using (true);')).toEqual([])
  })

  it('reports every occurrence in file order', () => {
    const sql = [
      'create policy "a" on t1 for all using (true);',
      'create policy "b" on t2 for all using (true);',
    ].join('\n')

    expect(findCreatedPolicies(sql)).toEqual(['t1.a', 't2.b'])
  })

  it('handles a drop and a re-create of the same policy, as migration 008 does', () => {
    const sql = [
      'drop policy if exists "users insert own clients" on clients;',
      'create policy "users insert own clients" on clients for insert with check (true);',
    ].join('\n')

    expect(findDroppedPolicies(sql)).toEqual(['clients.users insert own clients'])
    expect(findCreatedPolicies(sql)).toEqual(['clients.users insert own clients'])
  })

  it('lowercases the table name so casing cannot split one table into two', () => {
    expect(findCreatedPolicies('create policy "p" on ACCOUNTS for all using (true);')).toEqual(['accounts.p'])
  })

  it('finds a disabled table with or without the if exists clause', () => {
    const withClause = 'alter table if exists public.scans disable row level security;'
    const without = 'alter table scans disable row level security;'

    expect(findDisabledRlsTables(withClause)).toEqual(['scans'])
    expect(findDisabledRlsTables(without)).toEqual(['scans'])
  })

  it('does not mistake enabling RLS for disabling it', () => {
    const sql = 'alter table public.client_reports enable row level security;'

    expect(findDisabledRlsTables(sql)).toEqual([])
  })
})
