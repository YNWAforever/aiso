import { db } from '@/lib/db'
import { resolveCommercialEntitlement } from '@/lib/tier'
import { projectScanStatus } from '@/lib/view-models/scan-status'
import { DIRECTORY_COLUMNS, PAGE_SIZE, type DirectoryQuery, type DirectoryResult, type DirectoryRow } from './directory-schema'

/** Platform-only reads. Caller MUST pass requireApiAdmin before entering this store.
 * A null account filter intentionally lists all tenants for a platform administrator.
 * Every selected-account query uses the validated exact account, including joins.
 * No auth session, credential, billing identifier or arbitrary row serialization.
 */
export async function readAdminDirectory({ view, q, page, accountId }: DirectoryQuery): Promise<DirectoryResult> {
  const sql = db(), offset = (page - 1) * PAGE_SIZE, limit = PAGE_SIZE + 1
  // Literal substring search: '%' and '_' must not become caller-controlled wildcards.
  const term = '%' + q.replace(/[\\%_]/g, '\\$&') + '%'
  let rows: Record<string, unknown>[]
  switch (view) {
    case 'users':
      rows = await sql`select u.id, p.account_id, p.display_name as name, u.email,
        case when p.is_admin then 'platform_admin' else 'member' end as role,
        case when p.id is null then 'unprovisioned' when p.deactivated_at is null then 'active' else 'deactivated' end as status,
        coalesce(p.created_at::text, to_jsonb(u)->>'createdAt') as created_at
        from neon_auth."user" u left join profiles p on u.id::text = p.id::text
        where (${accountId}::uuid is null or p.account_id = ${accountId}::uuid)
          and (coalesce(p.display_name,'') ilike ${term} or coalesce(u.email,'') ilike ${term} or p.id::text ilike ${term})
        order by p.created_at desc nulls last, u.id desc limit ${limit} offset ${offset}`
      break
    case 'accounts':
      rows = await sql`select a.id, a.id as account_id, a.plan, a.status, a.stripe_subscription_id, a.created_at, a.trial_ends_at, a.override_plan, a.override_expires_at,
        (select p.display_name from profiles p where p.account_id = a.id order by p.created_at, p.id limit 1) as name,
        (select count(*)::int from profiles p where p.account_id = a.id) as users,
        (select count(*)::int from clients c where c.account_id = a.id) as brands
        from accounts a where (${accountId}::uuid is null or a.id = ${accountId}::uuid)
          and (a.id::text ilike ${term} or exists(select 1 from profiles p left join neon_auth."user" u on u.id::text = p.id::text
            where p.account_id = a.id and (coalesce(p.display_name,'') ilike ${term} or coalesce(u.email,'') ilike ${term})))
        order by a.created_at desc, a.id desc limit ${limit} offset ${offset}`
      rows = rows.map(row => ({ ...row, plan: resolveCommercialEntitlement(row).plan }))
      break
    case 'brands':
      rows = await sql`select c.id, c.account_id, c.brand_name as name, c.domain, c.industry, c.status, c.created_at
        from clients c where (${accountId}::uuid is null or c.account_id = ${accountId}::uuid)
          and (c.brand_name ilike ${term} or coalesce(c.domain,'') ilike ${term})
        order by c.created_at desc, c.id desc limit ${limit} offset ${offset}`
      break
    case 'scans':
      rows = await sql`select s.id, s.account_id, s.domain, s.score, s.grade, s.results->'evidence' as evidence, s.created_at
        from scans s where (${accountId}::uuid is null or s.account_id = ${accountId}::uuid) and s.domain ilike ${term}
        order by s.created_at desc, s.id desc limit ${limit} offset ${offset}`
      rows = rows.map(row => {
        const score = row.score === null ? null : Number(row.score)
        const display = projectScanStatus({ score, grade: typeof row.grade === 'string' ? row.grade : null, evidence: row.evidence })
        return { ...row, score: display.score, status: display.state }
      })
      break
    case 'prompts':
      rows = await sql`select p.id, c.account_id, p.question as name, c.brand_name as brand, p.category, p.language,
        to_jsonb(p)->>'market' as market, p.is_active as active
        from prompt_bank p join clients c on c.id = p.client_id
        where (${accountId}::uuid is null or c.account_id = ${accountId}::uuid) and (p.question ilike ${term} or c.brand_name ilike ${term})
        order by p.created_at desc, p.id desc limit ${limit} offset ${offset}`
      break
    case 'observations':
      rows = await sql`select m.id, c.account_id, m.question as name, c.brand_name as brand, m.platform, m.scan_week as week,
        case when to_jsonb(m)->>'classification_status' = 'classified' and m.raw_answer ~ '[^[:space:]]' then m.brand_mentioned else null end as mentioned,
        left(m.raw_answer, 8000) as excerpt
        from pulse_metrics m join clients c on c.id = m.client_id
        where (${accountId}::uuid is null or c.account_id = ${accountId}::uuid) and (m.question ilike ${term} or c.brand_name ilike ${term})
        order by m.created_at desc, m.id desc limit ${limit} offset ${offset}`
      break
    case 'runs':
      rows = await sql`select r.id, r.account_id, c.brand_name as brand, r.status, r.scan_week as week, r.updated_at
        from pulse_runs r join clients c on c.id = r.client_id and c.account_id = r.account_id
        where (${accountId}::uuid is null or r.account_id = ${accountId}::uuid) and (c.brand_name ilike ${term} or r.status ilike ${term})
        order by r.created_at desc, r.id desc limit ${limit} offset ${offset}`
      break
    case 'sources':
      rows = await sql`select s.id, s.account_id, s.label as name, c.brand_name as brand, s.kind, s.latest_version as version,
        (s.agent_use_allowed and s.revoked_at is null) as active, s.updated_at
        from client_sources s join clients c on c.id = s.client_id and c.account_id = s.account_id
        where (${accountId}::uuid is null or s.account_id = ${accountId}::uuid) and (s.label ilike ${term} or c.brand_name ilike ${term})
        order by s.created_at desc, s.id desc limit ${limit} offset ${offset}`
      break
    case 'work':
      rows = await sql`select w.id, w.account_id, w.title as name, c.brand_name as brand, w.status, w.updated_at
        from evidence_work_items w join clients c on c.id = w.client_id and c.account_id = w.account_id
        where (${accountId}::uuid is null or w.account_id = ${accountId}::uuid) and (w.title ilike ${term} or c.brand_name ilike ${term})
        order by w.created_at desc, w.id desc limit ${limit} offset ${offset}`
      break
  }
  const fields = ['id', 'account_id', ...DIRECTORY_COLUMNS[view]]
  const data = rows.slice(0, PAGE_SIZE).map(row => Object.fromEntries(fields.map(key => {
    const value = row[key]
    return [key, value instanceof Date ? value.toISOString() : ['string', 'number', 'boolean'].includes(typeof value) ? value : null]
  })) as DirectoryRow)
  return { rows: data, view, page, hasMore: rows.length > PAGE_SIZE }
}
