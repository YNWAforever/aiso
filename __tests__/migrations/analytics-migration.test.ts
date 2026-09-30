import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/055_analytics.sql', 'utf8')

// Literal on purpose: Task 9 switches this to an import of ANALYTICS_SYNC_OUTCOMES.
const OUTCOMES = [
  'ok', 'revoked', 'access_lost', 'google_unavailable', 'quota',
  'domain_mismatch', 'not_entitled', 'vault_error', 'config_error', 'internal_error',
  'deferred', 'scope_missing', 'events_missing',
]

const TABLES = ['analytics_bindings', 'analytics_daily', 'analytics_sync_runs']

/** The body of one `create table public.<name> ( ... );` statement. */
function tableBody(table: string): string {
  const start = sql.indexOf(`create table public.${table} (`)
  expect(start, `${table} is created`).toBeGreaterThanOrEqual(0)
  const end = sql.indexOf('\n);', start)
  return sql.slice(start, end)
}

describe('migration 055', () => {
  it('sorts after 054', () => {
    const files = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()
    expect(files.indexOf('055_analytics.sql')).toBeGreaterThan(files.indexOf('054_search_console.sql'))
  })

  it.each(TABLES)('creates %s', table => {
    expect(sql).toMatch(new RegExp(`create table public\\.${table}\\b`))
  })

  it.each(TABLES)('%s carries account_id and a composite client FK', table => {
    const body = tableBody(table)
    expect(body).toMatch(/account_id uuid not null/)
    expect(body).toContain('foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade')
  })

  it('pairs the binding with a connection of the same account, like 054', () => {
    expect(sql).toContain(
      'foreign key (connection_id, account_id) references public.google_connections (id, account_id) on delete cascade',
    )
  })

  it('names the constraints Task 10 upserts against', () => {
    expect(sql).toContain('constraint analytics_bindings_account_client_unique unique (account_id, client_id)')
    expect(sql).toMatch(
      /constraint analytics_daily_unique\s+unique \(account_id, client_id, date, event_name, source_class\)/,
    )
  })

  it('bounds the chosen events, and validates each element through an immutable helper', () => {
    expect(sql).toContain('cardinality(key_events) between 1 and 20')
    expect(sql).toMatch(/create function public\.analytics_event_names_valid\(text\[\]\)\s+returns boolean/)
    expect(sql).toMatch(/language sql\s+immutable/)
    expect(sql).toContain('analytics_event_names_valid(key_events)')
    // Every element 1-40 characters, and a null element is refused.
    expect(sql).toMatch(/char_length\(e\) between 1 and 40/)
    expect(sql).toMatch(/e is not null/)
  })

  it('pins numeric ids and caps the stream host', () => {
    expect(sql).toContain("check (property_id ~ '^[0-9]+$')")
    expect(sql).toContain("check (stream_id ~ '^[0-9]+$')")
    expect(sql).toContain('check (char_length(stream_host) <= 253)')
  })

  it('caps event_name, restricts source_class, and floors count at zero', () => {
    expect(sql).toContain('check (char_length(event_name) between 1 and 40)')
    expect(sql).toContain("check (source_class in ('organic_search', 'ai_assistant', 'other'))")
    expect(sql).toContain('count bigint not null,')
    expect(sql).toContain('check (count >= 0)')
  })

  it('pins the ledger vocabulary to exactly the 13 outcomes, in order', () => {
    const match = sql.match(/analytics_sync_runs_outcome_check check \(outcome in \(([^)]*)\)\)/)
    expect(match, 'the outcome CHECK exists').not.toBeNull()
    const listed = [...match![1]!.matchAll(/'([a-z_]+)'/g)].map(m => m[1])
    expect(listed).toEqual(OUTCOMES)
  })

  it('records the binding identity and the withheld flag on the ledger', () => {
    const body = tableBody('analytics_sync_runs')
    for (const column of ['connection_id uuid', 'property_id text', 'stream_id text']) {
      expect(body).toContain(column)
    }
    expect(body).toContain('data_withheld boolean not null default false')
    expect(body).toContain('rows_written integer not null default 0 check (rows_written >= 0)')
  })

  it('uses clock_timestamp() for ran_at so same-transaction runs cannot tie', () => {
    expect(sql).toContain('ran_at timestamptz not null default clock_timestamp()')
  })

  it('indexes the ledger newest-first per brand', () => {
    expect(sql).toContain('create index analytics_sync_runs_latest_idx')
    expect(sql).toContain('on public.analytics_sync_runs (account_id, client_id, ran_at desc)')
  })

  it('revokes everything from PUBLIC and aeo_app before granting', () => {
    expect(sql).toMatch(
      /revoke all on public\.analytics_bindings, public\.analytics_daily, public\.analytics_sync_runs from public;/,
    )
    expect(sql).toMatch(
      /revoke all on public\.analytics_bindings, public\.analytics_daily, public\.analytics_sync_runs from aeo_app;/,
    )
  })

  it('grants each table exactly what spec 3.2 lists', () => {
    expect(sql).toContain('grant select, insert, update, delete on public.analytics_bindings to aeo_app;')
    expect(sql).toContain('grant select, insert, delete on public.analytics_daily to aeo_app;')
    expect(sql).toContain('grant select, insert on public.analytics_sync_runs to aeo_app;')
  })

  it('gives daily no UPDATE and the ledger neither UPDATE nor DELETE', () => {
    expect(sql).not.toMatch(/grant [a-z, ]*update[a-z, ]* on public\.analytics_daily to aeo_app/)
    expect(sql).not.toMatch(/grant [a-z, ]*(update|delete)[a-z, ]* on public\.analytics_sync_runs to aeo_app/)
  })

  it('lets aeo_app execute the CHECK helper, because it runs as the inserting role', () => {
    expect(sql).toContain('revoke all on function public.analytics_event_names_valid(text[]) from public;')
    expect(sql).toContain('grant execute on function public.analytics_event_names_valid(text[]) to aeo_app;')
  })

  it('creates no RLS policy (036)', () => {
    expect(sql).not.toMatch(/create policy/i)
  })
})
