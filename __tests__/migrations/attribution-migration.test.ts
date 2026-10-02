import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync('supabase/migrations/056_attribution.sql', 'utf8')
const code = sql.replace(/--[^\n]*/g, '')
const flat = code.replace(/\s+/g, ' ')

/** The body of one `create table public.<name> ( ... );` statement. */
function tableBody(table: string): string {
  const start = sql.indexOf(`create table public.${table} (`)
  expect(start, `${table} is created`).toBeGreaterThanOrEqual(0)
  const end = sql.indexOf('\n);', start)
  return sql.slice(start, end)
}

describe('migration 056', () => {
  it('sorts after 055', () => {
    const files = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql')).sort()
    expect(files.indexOf('056_attribution.sql')).toBeGreaterThan(files.indexOf('055_analytics.sql'))
  })

  it('says in its header that it is applied to no persistent database', () => {
    expect(sql.split('\n').slice(0, 12).join('\n')).toMatch(/not applied to any persistent database|applied to no persistent database/i)
  })

  it.each(['work_item_delivery_measures', 'search_console_coverage'])('creates %s', table => {
    expect(sql).toMatch(new RegExp(`create table public\\.${table}\\b`))
  })

  it('adds covered_from to analytics_bindings as a nullable date', () => {
    expect(flat).toContain('alter table public.analytics_bindings add column covered_from date;')
  })

  describe('work_item_delivery_measures', () => {
    const body = () => tableBody('work_item_delivery_measures')

    it('carries the tenancy and attestation columns', () => {
      for (const column of [
        'id uuid primary key default gen_random_uuid()',
        'account_id uuid not null',
        'client_id uuid not null',
        'work_item_id uuid not null',
        'version_id uuid not null',
        'content_hash text not null',
        'attestation_id uuid not null',
        'asset_id uuid',
        'recorded_at timestamptz not null default clock_timestamp()',
      ]) {
        expect(body()).toContain(column)
      }
    })

    it('can only point at an attest event, never a withdraw', () => {
      expect(body()).toContain("attestation_kind text not null default 'attest'")
      expect(body()).toMatch(/check \(attestation_kind = 'attest'\)/)
    })

    it('restricts scope to site or page, and ties asset_id to scope', () => {
      expect(body()).toMatch(/check \(scope in \('site', 'page'\)\)/)
      expect(body()).toContain("check ((scope = 'site') = (asset_id is null))")
    })

    it('references the delivery event through the composite attestation FK, on delete restrict', () => {
      expect(flat).toContain(
        'foreign key (account_id, client_id, work_item_id, version_id, content_hash, attestation_id, attestation_kind) ' +
          'references public.work_item_delivery_events (account_id, client_id, work_item_id, version_id, content_hash, id, kind) ' +
          'on delete restrict',
      )
    })

    it('references the measured page through a composite asset FK, on delete restrict', () => {
      expect(flat).toContain(
        'foreign key (account_id, client_id, asset_id) references public.client_assets (account_id, client_id, id) on delete restrict',
      )
    })

    it('allows one site row or each page once, with nulls not distinct', () => {
      expect(flat).toContain('unique nulls not distinct (account_id, attestation_id, asset_id)')
    })

    it('indexes by attestation', () => {
      expect(flat).toContain(
        'on public.work_item_delivery_measures (account_id, client_id, attestation_id)',
      )
    })
  })

  describe('shape trigger', () => {
    it('is a deferrable initially deferred constraint trigger, per row, on insert', () => {
      expect(flat).toMatch(
        /create constraint trigger work_item_delivery_measures_shape_trg after insert on public\.work_item_delivery_measures deferrable initially deferred for each row execute function public\.work_item_delivery_measures_shape\(\);/,
      )
    })

    it('raises check_violation (23514) for a wrong shape', () => {
      expect(flat).toMatch(/errcode = 'check_violation'/)
    })

    it('accepts exactly one site row and no page rows, or 1 to 20 page rows and no site row', () => {
      expect(flat).toContain('(sites = 1 and pages = 0) or (sites = 0 and pages between 1 and 20)')
    })

    it('counts the attestation of the inserted row, within its own account', () => {
      expect(flat).toContain('account_id = new.account_id and attestation_id = new.attestation_id')
    })

    it('revokes EXECUTE from PUBLIC and grants it to aeo_app', () => {
      expect(sql).toContain('revoke all on function public.work_item_delivery_measures_shape() from public;')
      expect(sql).toContain('grant execute on function public.work_item_delivery_measures_shape() to aeo_app;')
    })
  })

  describe('search_console_coverage', () => {
    const body = () => tableBody('search_console_coverage')

    it('carries account_id and a composite client FK that cascades', () => {
      expect(body()).toMatch(/account_id uuid not null/)
      expect(body()).toContain(
        'foreign key (client_id, account_id) references public.clients (id, account_id) on delete cascade',
      )
    })

    it('restricts scope and ties page_url to it', () => {
      expect(body()).toMatch(/check \(scope in \('property', 'page'\)\)/)
      expect(body()).toContain("check ((scope = 'property') = (page_url is null))")
    })

    it('records a not-null covered_from and a covered_at default', () => {
      expect(body()).toContain('covered_from date not null')
      expect(body()).toContain('covered_at timestamptz not null default clock_timestamp()')
    })

    it('is unique per brand, scope and page with nulls not distinct', () => {
      expect(flat).toContain('unique nulls not distinct (account_id, client_id, scope, page_url)')
    })
  })

  it('revokes everything from PUBLIC and aeo_app before granting', () => {
    expect(flat).toContain(
      'revoke all on public.work_item_delivery_measures, public.search_console_coverage from public;',
    )
    expect(flat).toContain(
      'revoke all on public.work_item_delivery_measures, public.search_console_coverage from aeo_app;',
    )
  })

  it('issues exactly three GRANT statements, and measures are insert-only', () => {
    const grants = code
      .match(/\bgrant\s[^;]*;/gi)!
      .map(statement => statement.replace(/\s+/g, ' ').trim().toLowerCase())
    expect(grants).toEqual([
      'grant select, insert on public.work_item_delivery_measures to aeo_app;',
      'grant select, insert, update, delete on public.search_console_coverage to aeo_app;',
      'grant execute on function public.work_item_delivery_measures_shape() to aeo_app;',
    ])
    for (const grant of grants.filter(g => g.includes('work_item_delivery_measures to'))) {
      expect(grant).not.toMatch(/\b(update|delete|truncate|all)\b/)
    }
  })

  it('grants nothing to PUBLIC', () => {
    expect(code).not.toMatch(/\bgrant\s[^;]*\bto\s+public\b/i)
  })

  it('creates no RLS policy (036)', () => {
    expect(sql).not.toMatch(/create policy/i)
  })
})
