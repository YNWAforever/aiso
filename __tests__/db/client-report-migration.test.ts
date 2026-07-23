import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationPath = resolve(process.cwd(), 'supabase/migrations/027_client_report_snapshots.sql')

function readMigration() {
  return readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase()
}

function functionDefinition(sql: string, name: string) {
  return sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?as \\$function\\$[\\s\\S]*?\\$function\\$`))?.[0]
}

function updateSetClause(definition: string) {
  return definition.match(/update public\.client_reports set ([\s\S]*?) where/)?.[1] ?? ''
}

function publicReportReadViolations(sql: string) {
  const reportTables = new Set(['public.client_reports', 'public.client_report_versions'])
  const targetsPublicRole = (roleClause: string) => roleClause
    .split(',')
    .map(role => role.trim().replace(/^group\s+/, ''))
    .some(role => role === 'anon' || role === 'public')

  return sql.replace(/\s+/g, ' ').toLowerCase().split(';').map(statement => statement.trim()).filter(statement => {
    if (statement.startsWith('create policy ')) {
      const tableMatch = statement.match(/\bon\s+(?:table\s+)?(public\.[a-z_]+)\b/)
      if (!tableMatch || !reportTables.has(tableMatch[1])) return false

      const policyTail = statement.slice((tableMatch.index ?? 0) + tableMatch[0].length)
      const expressionOffsets = [policyTail.indexOf(' using '), policyTail.indexOf(' with check ')]
        .filter(offset => offset >= 0)
      const policyHeader = policyTail.slice(0, expressionOffsets.length > 0 ? Math.min(...expressionOffsets) : undefined)
      const command = policyHeader.match(/\bfor\s+(all|select|insert|update|delete)\b/)?.[1] ?? 'all'
      const roleClause = policyHeader.match(/\bto\s+(.+)$/)?.[1] ?? 'public'
      return (command === 'all' || command === 'select') && targetsPublicRole(roleClause)
    }

    if (!statement.startsWith('grant ')) return false
    const onOffset = statement.indexOf(' on ')
    if (onOffset < 0) return false

    const privileges = statement.slice('grant '.length, onOffset)
      .split(',')
      .map(privilege => privilege.trim().split(/[\s(]/, 1)[0])
    if (!privileges.some(privilege => privilege === 'select' || privilege === 'all')) return false

    const grantTarget = statement.slice(onOffset + ' on '.length)
    const toOffset = grantTarget.indexOf(' to ')
    if (toOffset < 0) return false

    const tableClause = grantTarget.slice(0, toOffset).replace(/^table\s+/, '')
    if (!tableClause.split(',').map(table => table.trim()).some(table => reportTables.has(table))) return false

    const roleClause = grantTarget.slice(toOffset + ' to '.length)
      .split(/\s+(?:with\s+grant\s+option|granted\s+by)\b/, 1)[0]
    return targetsPublicRole(roleClause)
  })
}

describe('client report migration contract', () => {
  it('creates the three tenant-owned tables with required data checks', () => {
    const sql = readMigration()

    expect(sql).toContain('create table public.account_report_branding')
    expect(sql).toContain('create table public.client_reports')
    expect(sql).toContain('create table public.client_report_versions')
    expect(sql).toMatch(/check \(status in \('draft',\s*'published',\s*'revoked'\)\)/)
    expect(sql).toContain('check (share_version > 0)')
    expect(sql).toContain("constraint client_reports_public_slug_format_check check (public_slug ~ '^[a-za-z0-9_-]{32}$')")
    expect(sql).toContain('check (view_count >= 0)')
    expect(sql).toContain('check (cta_click_count >= 0)')
    expect(sql).toMatch(/char_length\(btrim\(agency_name\)\) between 1 and 120/)
    expect(sql).toContain("primary_color ~ '^#[0-9a-fa-f]{6}$'")
    expect(sql).toMatch(/contact_label is null and contact_url is null.*contact_label is not null and contact_url is not null/)
    expect(sql).toMatch(/check \(locale in \('en',\s*'zh-hk'\)\)/)
    expect(sql).toMatch(/char_length\(executive_summary\) between 1 and 1200/)
    expect(sql).toContain('check (snapshot_schema_version = 1)')
    expect(sql).toContain('check (version_number > 0)')
  })

  it('uses composite tenant constraints and separate latest and published pointers', () => {
    const sql = readMigration()

    expect(sql).toMatch(/unique \(id, account_id, client_id\)/)
    expect(sql).toMatch(/unique \(report_id, version_number\)/)
    expect(sql).toMatch(/foreign key \(report_id, account_id, client_id\) references public\.client_reports \(id, account_id, client_id\)/)
    expect(sql).toMatch(/latest_version_id uuid/)
    expect(sql).toMatch(/published_version_id uuid/)
    expect(sql).toMatch(/foreign key \(latest_version_id, id\) references public\.client_report_versions \(id, report_id\)/)
    expect(sql).toMatch(/foreign key \(published_version_id, id\) references public\.client_report_versions \(id, report_id\)/)
    expect(sql).toMatch(/foreign key \(updated_by, account_id\) references public\.profiles \(id, account_id\)/)
    expect(sql.match(/foreign key \(created_by, account_id\) references public\.profiles \(id, account_id\)/g)).toHaveLength(2)
    expect(sql).toContain('revoke update, delete on table public.client_report_versions from service_role')
  })

  it('enables RLS and only grants tenant-bound collaborator reads', () => {
    const sql = readMigration()

    for (const table of ['account_report_branding', 'client_reports', 'client_report_versions']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`)
    }
    expect(publicReportReadViolations(sql)).toEqual([])
    expect(sql).not.toMatch(/create policy[^;]+using \(true\)/)
    expect(sql).toMatch(/profiles\.account_id = account_report_branding\.account_id/)
    expect(sql).toMatch(/profiles\.account_id = client_reports\.account_id/)
    expect(sql).toMatch(/profiles\.account_id = client_report_versions\.account_id/)
    expect(sql).toContain('revoke all on table public.client_reports from anon, authenticated')
    expect(sql).toContain('revoke all on table public.client_report_versions from anon, authenticated')
    expect(sql).toContain('revoke all on table public.client_reports from service_role')
    expect(sql).toContain('revoke all on table public.client_report_versions from service_role')
    expect(sql).toContain('grant select on table public.client_reports to authenticated')
    expect(sql).toContain('grant select on table public.client_report_versions to authenticated')
  })

  it('detects canonical anon/public report read policies and grants', () => {
    const unsafeSql = `
      CREATE POLICY unsafe_report_read ON public.client_reports
        FOR SELECT TO anon USING (true);
      GRANT SELECT ON TABLE public.client_report_versions TO PUBLIC;
    `

    expect(publicReportReadViolations(unsafeSql)).toHaveLength(2)
  })

  it('detects a report policy whose omitted command and role default to ALL and PUBLIC', () => {
    const unsafeSql = `
      CREATE POLICY unsafe_default_report_access
        ON public.client_reports
        USING (true);
    `

    expect(publicReportReadViolations(unsafeSql)).toHaveLength(1)
  })

  it('detects SELECT anywhere in a direct grant privilege list', () => {
    const unsafeSql = `
      GRANT INSERT, SELECT ON public.client_report_versions TO anon;
    `

    expect(publicReportReadViolations(unsafeSql)).toHaveLength(1)
  })

  it('defines locked service-only atomic RPCs with hardened definer scope', () => {
    const sql = readMigration()
    const functions = [
      'create_client_report_with_version',
      'append_client_report_version',
      'publish_client_report_latest',
      'revoke_client_report',
      'rotate_client_report_link',
      'increment_client_report_view',
      'increment_client_report_cta_click',
    ]

    for (const name of functions) {
      const definition = functionDefinition(sql, name)
      expect(definition, `${name} definition`).toBeDefined()
      expect(definition).toContain('security definer')
      expect(definition).toContain("set search_path = ''")
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${name}\\([^;]+ from public`))
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${name}\\([^;]+ from anon`))
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${name}\\([^;]+ from authenticated`))
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^;]+ to service_role`))
    }

    const append = functionDefinition(sql, 'append_client_report_version')
    expect(append).toContain('pg_catalog.pg_advisory_xact_lock')
    expect(append).toMatch(/from public\.client_reports[\s\S]*for update/)
    expect(append).toMatch(/max\(client_report_versions\.version_number\) \+ 1/)
    expect(append).toMatch(/set latest_version_id = new_version\.id,[^;]*updated_at = pg_catalog\.now\(\)/)
    expect(append).not.toMatch(/set[^;]*published_version_id/)

    for (const name of ['create_client_report_with_version', 'append_client_report_version']) {
      const definition = functionDefinition(sql, name) ?? ''
      expect(definition).toContain('returns jsonb')
      expect(definition).toContain('new_version public.client_report_versions')
      expect(definition).toMatch(/returning \* into new_version/)
      expect(definition).toMatch(/pg_catalog\.jsonb_build_object\(\s*'report',\s*pg_catalog\.to_jsonb\([^)]*\),\s*'version',\s*pg_catalog\.to_jsonb\(new_version\)/)
    }

    const lifecycleNames = [
      'append_client_report_version',
      'publish_client_report_latest',
      'revoke_client_report',
      'rotate_client_report_link',
    ]
    for (const name of lifecycleNames) {
      const definition = functionDefinition(sql, name) ?? ''
      const advisoryLock = definition.indexOf('pg_catalog.pg_advisory_xact_lock')
      const rowLock = definition.indexOf('for update')
      expect(advisoryLock, `${name} advisory lock`).toBeGreaterThanOrEqual(0)
      expect(rowLock, `${name} row lock`).toBeGreaterThan(advisoryLock)
    }

    expect(append).toMatch(/published_version public\.client_report_versions/)
    expect(append).toMatch(/where client_report_versions\.id = locked_report\.published_version_id/)
    expect(append).toMatch(/published_version_id_before_append uuid/)
    expect(append).toMatch(/published_version_id_before_append := locked_report\.published_version_id/)
    expect(append).toMatch(/'previous_published_version_id',\s*published_version_id_before_append/)
    expect(append).toMatch(/'published_version',\s*pg_catalog\.to_jsonb\(published_version\)/)

    for (const name of ['publish_client_report_latest', 'rotate_client_report_link']) {
      const definition = functionDefinition(sql, name) ?? ''
      expect(definition).toContain('returns jsonb')
      expect(definition).toMatch(/published_version public\.client_report_versions/)
      expect(definition).toMatch(/where client_report_versions\.id = locked_report\.published_version_id/)
      expect(definition).toMatch(/jsonb_build_object\(\s*'report',\s*pg_catalog\.to_jsonb\(locked_report\),\s*'published_version',\s*pg_catalog\.to_jsonb\(published_version\)/)
    }

    const publish = functionDefinition(sql, 'publish_client_report_latest') ?? ''
    expect(publish).toContain('p_reviewed_version_id uuid')
    expect(publish).toMatch(/locked_report\.latest_version_id is distinct from p_reviewed_version_id/)
    expect(publish).toMatch(/raise exception 'reviewed version is stale'/)

    const revoke = functionDefinition(sql, 'revoke_client_report') ?? ''
    expect(revoke).toContain('returns jsonb')
    expect(revoke).toMatch(/jsonb_build_object\(\s*'report',\s*pg_catalog\.to_jsonb\(locked_report\)/)

    for (const name of ['revoke_client_report', 'rotate_client_report_link']) {
      const definition = functionDefinition(sql, name) ?? ''
      expect(definition).toMatch(/latest_version public\.client_report_versions/)
      expect(definition).toMatch(/published_version public\.client_report_versions/)
      expect(definition).toMatch(/where client_report_versions\.id = locked_report\.latest_version_id/)
      expect(definition).toMatch(/where client_report_versions\.id = locked_report\.published_version_id/)
      expect(definition).toMatch(/'latest_version',\s*pg_catalog\.to_jsonb\(latest_version\)/)
      expect(definition).toMatch(/'published_version',\s*pg_catalog\.to_jsonb\(published_version\)/)
    }

    const rotate = functionDefinition(sql, 'rotate_client_report_link') ?? ''
    expect(rotate).toMatch(/locked_report\.status <> 'published'/)
    expect(rotate).toMatch(/locked_report\.published_version_id is null/)
  })

  it('binds create and append scans to the owned client normalized hostname', () => {
    const sql = readMigration()

    for (const name of ['create_client_report_with_version', 'append_client_report_version']) {
      const definition = functionDefinition(sql, name) ?? ''
      expect(definition).toMatch(/select clients\.domain into client_domain from public\.clients where clients\.id = p_client_id and clients\.account_id = p_account_id/)
      expect(definition).toMatch(/select scans\.domain, scans\.created_at into source_domain, source_created_at from public\.scans where scans\.id = p_source_scan_id and scans\.account_id = p_account_id/)
      expect(definition).toContain("pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(client_domain)), '^www\\.', '')")
      expect(definition).toContain("pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(source_domain)), '^www\\.', '')")
      expect(definition).toContain("pg_catalog.regexp_replace(pg_catalog.lower(pg_catalog.btrim(previous_domain)), '^www\\.', '')")
      expect(definition).toMatch(/previous_created_at >= source_created_at/)
      expect(definition).toContain("pg_catalog.strpos(client_domain, '://') > 0")
      expect(definition).not.toContain('pg_catalog.position(')
    }
  })

  it('keeps counters narrow and rotates credentials on revoke, rotate, and revoked publish', () => {
    const sql = readMigration()
    const view = functionDefinition(sql, 'increment_client_report_view') ?? ''
    const cta = functionDefinition(sql, 'increment_client_report_cta_click') ?? ''
    const viewSet = updateSetClause(view)
    const ctaSet = updateSetClause(cta)

    expect(viewSet).toMatch(/view_count = client_reports\.view_count \+ 1,[^;]*first_viewed_at = pg_catalog\.coalesce\([^;]*last_viewed_at = pg_catalog\.now\(\)/)
    expect(viewSet).not.toMatch(/status\s*=|published_version_id\s*=|public_slug\s*=|share_version\s*=/)
    expect(ctaSet).toMatch(/cta_click_count = client_reports\.cta_click_count \+ 1/)
    expect(ctaSet).not.toMatch(/status\s*=|published_version_id\s*=|public_slug\s*=|share_version\s*=/)

    for (const name of ['revoke_client_report', 'rotate_client_report_link']) {
      const definition = functionDefinition(sql, name) ?? ''
      expect(definition).toMatch(/share_version = locked_report\.share_version \+ 1/)
      expect(definition).toMatch(/public_slug = pg_catalog\.translate\(/)
    }
    const publish = functionDefinition(sql, 'publish_client_report_latest') ?? ''
    expect(publish).toMatch(/case when locked_report\.status = 'revoked' then locked_report\.share_version \+ 1/)
    expect(publish).toMatch(/case when locked_report\.status = 'revoked' then pg_catalog\.translate\(/)
  })

  it('indexes tenant list and same-domain history predicates', () => {
    const sql = readMigration()

    expect(sql).toMatch(/create index client_reports_account_client_created_idx on public\.client_reports \(account_id, client_id, created_at desc\)/)
    expect(sql).toMatch(/create unique index client_reports_public_slug_idx on public\.client_reports \(public_slug\)/)
    expect(sql).toMatch(/create index scans_account_domain_created_idx on public\.scans \(account_id, domain, created_at desc\)/)
  })

  it('does not modify migrations 001 through 026 from the task base', () => {
    const changedMigrations = execFileSync('git', [
      'diff',
      '--name-only',
      '27d10f7bc3d47c13ce7e672ca7909036804e51ed',
      '--',
      'supabase/migrations',
    ], { cwd: process.cwd(), encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(path => /^supabase\/migrations\/0(?:0[1-9]|1[0-9]|2[0-6])_/.test(path))

    expect(changedMigrations).toEqual([])
  })
})
