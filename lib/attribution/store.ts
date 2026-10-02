import 'server-only'
import { db } from '@/lib/db'
import type { SourceClass } from '@/lib/integrations/analytics/sources'
import { PAGE_CAP } from '@/lib/integrations/search-console/sync'
import type { EnquiryDay, SourceState } from './types'
import { deliveryDay, windowsFor } from './windows'

/**
 * All SQL for Attribution (spec §5.1). Its own statements, importing no other
 * store, so the connectors' stores can change without breaking it. Every
 * statement names account_id with the session's value; none uses `returning *`.
 *
 * Date contracts compareTarget relies on (lib/attribution/types.ts):
 *  - delivered_at and bound_at leave as ISO instants (to_char … at time zone
 *    'UTC'), never `::date`, which is a UTC date and would be misread as a Hong
 *    Kong one at the window edges.
 *  - ok-run dates are Hong Kong dates: (ran_at at time zone 'Asia/Hong_Kong')::date.
 *    Not the Search Console store's lastOkDate, which is a UTC date.
 *  - daily dates are plain `date::text`, ordered, so float sums are repeatable.
 *
 * Search Console's sync set: the Search Console sync fetches only the PAGE_CAP
 * oldest registered pages (listSyncPages: `order by a.created_at, a.id`, with a
 * url-length filter). This file states the same set itself rather than importing
 * that store; __tests__/lib/attribution-store.test.ts pins the two texts together
 * and the integration suite proves they agree on real Postgres.
 */

type Row = Record<string, unknown>

export type MeasuredTarget = {
  scope: 'site' | 'page'
  /** The measured registered page; null for the whole site. */
  asset: { id: string; url: string; label: string } | null
  /** Whether Search Console syncs this page (always true for the whole site). */
  synced: boolean
}

export type CoverageRow = { scope: 'property' | 'page'; pageUrl: string | null; coveredFrom: string }

export type StoredSearchDay = {
  scope: 'property' | 'page'
  pageUrl: string | null
  date: string
  clicks: number
  impressions: number
  position: number
}

export type AttributionSources = {
  /** The Search Console binding's state, coverage aside (that is per target). Null when the brand has no binding. */
  search: Omit<SourceState, 'coveredFrom'> | null
  coverage: CoverageRow[]
  searchDays: StoredSearchDay[]
  /**
   * GA4, read only for a site measure when the caller says analytics is enabled
   * and entitled; null when it was not read. `state` is null when the brand has
   * no analytics binding.
   */
  enquiries: { state: SourceState | null; days: EnquiryDay[] } | null
}

export type AttributionInput = {
  schemaVersion: number
  /** The version's newest attestation, and whether a withdraw targets it. Null when it was never attested. */
  attestation: { id: string; deliveredAt: string; withdrawn: boolean } | null
  /** That attestation's measures only, site first. */
  measures: MeasuredTarget[]
  /**
   * The source reads. Null when there is nothing to compare: no attestation, a
   * withdrawn one, an unsupported version, or nothing measured.
   */
  sources: AttributionSources | null
}

const text = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

/**
 * The guard's ownership lookup: this version, of this work item, of this brand,
 * in the session's account. False means absent or not yours, and the caller
 * cannot tell which. A driver error escapes so the guard answers 503.
 */
export async function loadOwnedVersion(
  accountId: string,
  clientId: string,
  itemId: string,
  versionId: string,
): Promise<boolean> {
  const sql = db()
  const rows = await sql`
    select v.id
    from work_item_versions v
    join clients c on c.id = v.client_id and c.account_id = v.account_id
    where v.account_id = ${accountId}::uuid and v.client_id = ${clientId}::uuid
      and v.work_item_id = ${itemId}::uuid and v.id = ${versionId}::uuid
    limit 1
  `
  return rows.length > 0
}

/**
 * The ids of this brand's registered pages that Search Console syncs: the
 * PAGE_CAP oldest, exactly as listSyncPages takes them. The delivery form offers
 * only these for measuring.
 */
export async function loadSyncedPageIds(accountId: string, clientId: string): Promise<string[]> {
  const sql = db()
  const rows = await sql`
    select s.id
    from client_assets s
    where s.account_id = ${accountId}::uuid and s.client_id = ${clientId}::uuid and char_length(s.url) <= 2048
    order by s.created_at, s.id
    limit ${PAGE_CAP}
  `
  return rows.map(r => String(r.id))
}

/**
 * Everything one version's measured change is computed from. Null when the
 * version is not this account's (raced away after the guard).
 *
 * The attestation is the version's NEWEST attest event; measures are that
 * attestation's alone, so after withdraw-then-re-attest only the new choice
 * surfaces (Review Focus 4). Measures are insert-only and written in the
 * attestation's own statement, so they cannot change under this read.
 * Each measured page carries whether it is in Search Console's sync set today;
 * compareTarget answers `unavailable` / `page_not_synced` for one that is not.
 *
 * The source reads share one read-only repeatable-read snapshot, so a sync
 * landing between them cannot pair one run's ledger with another run's rows.
 */
export async function loadAttributionInput(
  accountId: string,
  clientId: string,
  itemId: string,
  versionId: string,
  options: { analytics: boolean },
): Promise<AttributionInput | null> {
  const sql = db()
  const [head] = await sql`
    with version as (
      select v.id, v.content_hash, v.content ->> 'schemaVersion' as schema_version
      from work_item_versions v
      where v.account_id = ${accountId}::uuid and v.client_id = ${clientId}::uuid
        and v.work_item_id = ${itemId}::uuid and v.id = ${versionId}::uuid
    ), latest as (
      select e.id, e.delivered_at
      from work_item_delivery_events e
      join version v on e.version_id = v.id and e.content_hash = v.content_hash
      where e.account_id = ${accountId}::uuid and e.client_id = ${clientId}::uuid
        and e.work_item_id = ${itemId}::uuid and e.kind = 'attest'
      order by e.recorded_at desc, e.id desc limit 1
    ), synced as (
      select s.id
      from client_assets s
      where s.account_id = ${accountId}::uuid and s.client_id = ${clientId}::uuid and char_length(s.url) <= 2048
      order by s.created_at, s.id
      limit ${PAGE_CAP}
    )
    select exists (select 1 from version) as found,
      (select schema_version from version) as schema_version,
      (select l.id from latest l) as attestation_id,
      (select to_char(l.delivered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') from latest l) as delivered_at,
      exists (
        select 1 from work_item_delivery_events w join latest l on w.target_attestation_id = l.id
        where w.account_id = ${accountId}::uuid and w.client_id = ${clientId}::uuid
          and w.work_item_id = ${itemId}::uuid and w.kind = 'withdraw'
      ) as withdrawn,
      coalesce((
        select jsonb_agg(jsonb_build_object('scope', m.scope, 'assetId', a.id, 'url', a.url, 'label', a.label,
            'synced', exists (select 1 from synced s where s.id = a.id))
          order by (m.scope = 'site') desc, a.label, a.url, m.id)
        from work_item_delivery_measures m
        join latest l on m.attestation_id = l.id
        left join client_assets a on a.account_id = m.account_id and a.client_id = m.client_id and a.id = m.asset_id
        where m.account_id = ${accountId}::uuid and m.client_id = ${clientId}::uuid
      ), '[]'::jsonb) as measures
  `
  if (!head || head.found !== true) return null

  const schemaVersion = Number(head.schema_version)
  const attestation = head.attestation_id
    ? { id: String(head.attestation_id), deliveredAt: String(head.delivered_at), withdrawn: head.withdrawn === true }
    : null
  const measures: MeasuredTarget[] = (head.measures as Row[]).map(r =>
    r.scope === 'site'
      ? { scope: 'site', asset: null, synced: true }
      : {
          scope: 'page',
          asset: { id: String(r.assetId), url: String(r.url), label: String(r.label) },
          // Only an explicit true is synced: a missing flag never offers a comparison.
          synced: r.synced === true,
        },
  )

  if (!attestation || attestation.withdrawn || schemaVersion !== 1 || measures.length === 0) {
    return { schemaVersion, attestation, measures, sources: null }
  }
  return { schemaVersion, attestation, measures, sources: await readSources(accountId, clientId, attestation.deliveredAt, measures, options) }
}

async function readSources(
  accountId: string,
  clientId: string,
  deliveredAt: string,
  measures: MeasuredTarget[],
  options: { analytics: boolean },
): Promise<AttributionSources> {
  const w = windowsFor(deliveryDay(deliveredAt))
  const from = w.before.from
  const to = w.after.to
  const site = measures.some(t => t.scope === 'site')
  const urls = measures.flatMap(t => (t.asset ? [t.asset.url] : []))
  const readGa4 = site && options.analytics

  const sql = db()
  const queries = [
    sql`
      select to_char(b.bound_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as bound_at,
        (select max((r.ran_at at time zone 'Asia/Hong_Kong')::date)::text
           from search_console_sync_runs r
          where r.account_id = b.account_id and r.client_id = b.client_id
            and r.outcome = 'ok' and r.ran_at >= b.bound_at) as last_ok_day,
        (select r.outcome
           from search_console_sync_runs r
          where r.account_id = b.account_id and r.client_id = b.client_id
            and r.outcome <> 'deferred' and r.ran_at >= b.bound_at
          order by r.ran_at desc limit 1) as latest_outcome
      from search_console_bindings b
      where b.account_id = ${accountId}::uuid and b.client_id = ${clientId}::uuid
      limit 1
    `,
    sql`
      select scope, page_url, covered_from::text as covered_from
      from search_console_coverage
      where account_id = ${accountId}::uuid and client_id = ${clientId}::uuid
        and ((scope = 'property' and ${site}::boolean) or (scope = 'page' and page_url = any(${urls}::text[])))
    `,
    // synced_at >= bound_at: only what was written for the CURRENT binding. An
    // in-flight sync of an old property can still land rows after a rebind; this
    // filter and compareTarget's rebound rule together keep them out.
    sql`
      select d.scope, d.page_url, d.date::text as date, d.clicks, d.impressions, d.position
      from search_console_daily d
      join search_console_bindings b on b.account_id = d.account_id and b.client_id = d.client_id
      where d.account_id = ${accountId}::uuid and d.client_id = ${clientId}::uuid
        and d.date between ${from}::date and ${to}::date
        and d.synced_at >= b.bound_at
        and ((d.scope = 'property' and ${site}::boolean) or (d.scope = 'page' and d.page_url = any(${urls}::text[])))
      order by d.scope, d.page_url, d.date
    `,
  ]
  if (readGa4) {
    queries.push(
      // Coverage and readiness count only runs since the binding AND the current
      // event choice: an earlier run synced another stream or other events. The
      // withheld flag uses the same ok runs: if Google withheld data from any of
      // them, the counts these figures sum may be lower than actual.
      sql`
        select to_char(b.bound_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as bound_at,
          b.covered_from::text as covered_from,
          (select max((r.ran_at at time zone 'Asia/Hong_Kong')::date)::text
             from analytics_sync_runs r
            where r.account_id = b.account_id and r.client_id = b.client_id
              and r.outcome = 'ok' and r.ran_at >= greatest(b.bound_at, b.events_chosen_at)) as last_ok_day,
          (select coalesce(bool_or(r.data_withheld), false)
             from analytics_sync_runs r
            where r.account_id = b.account_id and r.client_id = b.client_id
              and r.outcome = 'ok' and r.ran_at >= greatest(b.bound_at, b.events_chosen_at)) as data_withheld,
          (select r.outcome
             from analytics_sync_runs r
            where r.account_id = b.account_id and r.client_id = b.client_id
              and r.outcome <> 'deferred' and r.ran_at >= greatest(b.bound_at, b.events_chosen_at)
            order by r.ran_at desc limit 1) as latest_outcome
        from analytics_bindings b
        where b.account_id = ${accountId}::uuid and b.client_id = ${clientId}::uuid
        limit 1
      `,
      sql`
        select d.date::text as date, d.source_class, sum(d.count)::bigint as count
        from analytics_daily d
        join analytics_bindings b on b.account_id = d.account_id and b.client_id = d.client_id
        where d.account_id = ${accountId}::uuid and d.client_id = ${clientId}::uuid
          and d.date between ${from}::date and ${to}::date
          and d.event_name = any(b.key_events)
          and d.synced_at >= greatest(b.bound_at, b.events_chosen_at)
        group by d.date, d.source_class
        order by d.date, d.source_class
      `,
    )
  }

  const results = (await sql.transaction(queries, { isolationLevel: 'RepeatableRead', readOnly: true })) as Row[][]
  const [scBinding] = results[0] ?? []

  const sources: AttributionSources = {
    search: scBinding
      ? {
          boundAt: String(scBinding.bound_at),
          // compareTarget only asks whether SOME ok run is on or after ready-on,
          // so the newest one is the whole answer.
          okRunDates: scBinding.last_ok_day ? [String(scBinding.last_ok_day)] : [],
          latestOutcome: text(scBinding.latest_outcome),
        }
      : null,
    coverage: (results[1] ?? []).map(r => ({
      scope: r.scope as CoverageRow['scope'],
      pageUrl: text(r.page_url),
      coveredFrom: String(r.covered_from),
    })),
    searchDays: (results[2] ?? []).map(r => ({
      scope: r.scope as StoredSearchDay['scope'],
      pageUrl: text(r.page_url),
      date: String(r.date),
      clicks: Number(r.clicks),
      impressions: Number(r.impressions),
      position: Number(r.position),
    })),
    enquiries: null,
  }

  if (readGa4) {
    const [gaBinding] = results[3] ?? []
    sources.enquiries = {
      state: gaBinding
        ? {
            boundAt: String(gaBinding.bound_at),
            coveredFrom: text(gaBinding.covered_from),
            okRunDates: gaBinding.last_ok_day ? [String(gaBinding.last_ok_day)] : [],
            latestOutcome: text(gaBinding.latest_outcome),
            withheld: gaBinding.data_withheld === true,
          }
        : null,
      days: (results[4] ?? []).map(r => ({
        date: String(r.date),
        sourceClass: r.source_class as SourceClass,
        count: Number(r.count),
      })),
    }
  }
  return sources
}
