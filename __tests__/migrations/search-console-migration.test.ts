import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SYNC_OUTCOMES } from '@/lib/integrations/search-console/state'

const sql = readFileSync('supabase/migrations/054_search_console.sql', 'utf8')

describe('migration 054', () => {
  it.each([
    'google_connections', 'search_console_bindings', 'search_console_daily',
    'search_console_page_queries', 'search_console_sync_runs',
  ])('creates %s', table => {
    expect(sql).toMatch(new RegExp(`create table public\\.${table}\\b`))
  })

  it('uses the column-list form for every set-null actor FK', () => {
    // The plain form would also null account_id, which is NOT NULL — the 044/046 trap.
    expect(sql).toContain('on delete set null (connected_by)')
    expect(sql).toContain('on delete set null (bound_by)')
    expect(sql).not.toMatch(/on delete set null\s*[,)\n]/)
  })

  it('makes daily metrics idempotent with nulls not distinct', () => {
    expect(sql).toContain('unique nulls not distinct (client_id, scope, page_url, date)')
  })

  it('pins the ledger vocabulary to the one the code knows', () => {
    for (const outcome of SYNC_OUTCOMES) expect(sql).toContain(`'${outcome}'`)
  })

  it('grants aeo_app no DELETE on history', () => {
    for (const table of ['search_console_daily', 'search_console_page_queries', 'search_console_sync_runs']) {
      expect(sql).toMatch(new RegExp(`grant select, insert, update on public\\.${table} to aeo_app`))
    }
  })

  it('creates no RLS policy (036)', () => {
    expect(sql).not.toMatch(/create policy/i)
  })
})
