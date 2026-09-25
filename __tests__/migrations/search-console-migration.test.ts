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

  it('makes daily metrics idempotent with nulls not distinct, account_id first', () => {
    expect(sql).toContain('unique nulls not distinct (account_id, client_id, date, scope, page_url)')
  })

  it('leads the page-queries unique key with account_id too', () => {
    expect(sql).toContain('unique (account_id, client_id, page_url, date, query)')
  })

  it('drops the now-redundant daily read index', () => {
    expect(sql).not.toContain('search_console_daily_read_idx')
  })

  it('pins the ledger vocabulary to the one the code knows', () => {
    for (const outcome of SYNC_OUTCOMES) expect(sql).toContain(`'${outcome}'`)
  })

  it('grants aeo_app DELETE on page queries only, not on daily or the ledger', () => {
    expect(sql).toMatch(/grant select, insert, update, delete on public\.search_console_page_queries to aeo_app/)
    expect(sql).toMatch(/grant select, insert, update on public\.search_console_daily to aeo_app/)
    for (const table of ['search_console_daily', 'search_console_sync_runs']) {
      expect(sql).not.toMatch(new RegExp(`grant [a-z, ]*delete[a-z, ]* on public\\.${table} to aeo_app`))
    }
  })

  it('keeps the ledger insert-only: no UPDATE for aeo_app', () => {
    expect(sql).toMatch(/grant select, insert on public\.search_console_sync_runs to aeo_app;/)
    expect(sql).not.toMatch(/grant [a-z, ]*update[a-z, ]* on public\.search_console_sync_runs to aeo_app/)
  })

  it('bounds ctr and position against NaN and Infinity, floor at 0', () => {
    expect(sql).toContain("check (ctr >= 0 and ctr <= 1)")
    const positionChecks = sql.match(/check \(position >= 0 and position < 'Infinity'\)/g) ?? []
    expect(positionChecks.length).toBe(2)
  })

  it('caps page_url and query lengths', () => {
    expect(sql).toContain('check (page_url is null or char_length(page_url) <= 2048)')
    expect(sql).toContain('check (char_length(page_url) <= 2048)')
    expect(sql).toContain('check (char_length(query) <= 512)')
  })

  it('normalises bound_domain like 053', () => {
    expect(sql).toContain("check ((bound_domain = lower(btrim(bound_domain)) and bound_domain like '%.%') is true)")
  })

  it('pins the permission_level vocabulary', () => {
    expect(sql).toContain("check (permission_level in ('siteOwner', 'siteFullUser', 'siteRestrictedUser'))")
  })

  it('rejects an empty (but non-null) token_key_id', () => {
    expect(sql).toContain("token_key_id is null or token_key_id <> ''")
  })

  it('indexes bindings by connection and sync runs by last good outcome', () => {
    expect(sql).toContain('create index search_console_bindings_connection_idx')
    expect(sql).toContain('on public.search_console_bindings (connection_id, account_id)')
    expect(sql).toContain('create index search_console_sync_runs_last_good_idx')
    expect(sql).toMatch(/on public\.search_console_sync_runs \(account_id, client_id, data_through desc\)\s*\n\s*where outcome = 'ok'/)
  })

  it('uses clock_timestamp() for ran_at so same-transaction runs cannot tie', () => {
    expect(sql).toContain('ran_at timestamptz not null default clock_timestamp()')
  })

  it('creates no RLS policy (036)', () => {
    expect(sql).not.toMatch(/create policy/i)
  })
})
