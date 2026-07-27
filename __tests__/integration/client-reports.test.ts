import { describe, it, expect, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'

// Calls the seven real Postgres functions in
// supabase/migrations/027_client_report_snapshots.sql against a real
// ephemeral Neon branch, with the exact named-argument call shape
// lib/reports/store.ts uses (`p_foo => value`). This feature was built,
// reviewed, and merged but has never run against a live database — a mock
// would happily accept a transposed argument (these functions have several
// same-typed uuid/text parameters), so only running the real functions
// proves the mapping in store.ts is right.
const sql = neon(process.env.TEST_DATABASE_URL!)

const ACCOUNT = '55555555-5555-5555-5555-555555555555'
const OTHER = '66666666-6666-6666-6666-666666666666'
const DOMAIN = 'client-reports-test.example'

async function seed() {
  // client_reports.latest_version_id/published_version_id point AT
  // client_report_versions, so deleting versions first would violate that FK.
  // Deleting client_reports first cascades its versions automatically
  // (client_report_versions_report_tenant_fkey ... on delete cascade); the
  // explicit version delete after is just a safety net for orphans.
  await sql`delete from client_reports where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from client_report_versions where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from scans where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from clients where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from accounts where id in (${ACCOUNT}, ${OTHER})`
  for (const id of [ACCOUNT, OTHER]) {
    await sql`insert into accounts (id, plan, status, stripe_subscription_id)
              values (${id}, 'pro', 'active', ${'sub_' + id.slice(0, 8)})`
  }
}

async function seedClient(account: string, domain: string): Promise<string> {
  const rows = await sql`
    insert into clients (brand_name, account_id, status, competitors, domain)
    values (${'Client Reports Test'}, ${account}, 'active', ${[]}::text[], ${domain})
    returning id
  `
  return rows[0].id as string
}

async function seedScan(account: string, domain: string, score: number, createdAt: string): Promise<string> {
  const rows = await sql`
    insert into scans (url, domain, score, results, account_id, created_at)
    values (${'https://' + domain}, ${domain}, ${score}, ${'{}'}::jsonb, ${account}, ${createdAt}::timestamptz)
    returning id
  `
  return rows[0].id as string
}

type RpcArgs = {
  accountId: string
  clientId: string
  sourceScanId: string
  previousScanId: string | null
  locale: string
  executiveSummary: string
  snapshot: unknown
  createdBy: string | null
}

async function createReport(args: RpcArgs) {
  const rows = await sql`
    select create_client_report_with_version(
      p_account_id              => ${args.accountId}::uuid,
      p_client_id               => ${args.clientId}::uuid,
      p_source_scan_id          => ${args.sourceScanId}::uuid,
      p_previous_scan_id        => ${args.previousScanId}::uuid,
      p_locale                  => ${args.locale},
      p_executive_summary       => ${args.executiveSummary},
      p_snapshot_schema_version => 1,
      p_snapshot                => ${JSON.stringify(args.snapshot)}::jsonb,
      p_created_by              => ${args.createdBy}::uuid
    ) as result
  `
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows[0].result as any
}

async function appendVersion(args: RpcArgs & { reportId: string }) {
  const rows = await sql`
    select append_client_report_version(
      p_report_id               => ${args.reportId}::uuid,
      p_account_id              => ${args.accountId}::uuid,
      p_client_id               => ${args.clientId}::uuid,
      p_source_scan_id          => ${args.sourceScanId}::uuid,
      p_previous_scan_id        => ${args.previousScanId}::uuid,
      p_locale                  => ${args.locale},
      p_executive_summary       => ${args.executiveSummary},
      p_snapshot_schema_version => 1,
      p_snapshot                => ${JSON.stringify(args.snapshot)}::jsonb,
      p_created_by              => ${args.createdBy}::uuid
    ) as result
  `
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows[0].result as any
}

async function publish(args: { accountId: string; clientId: string; reportId: string; reviewedVersionId: string }) {
  const rows = await sql`
    select publish_client_report_latest(
      p_report_id           => ${args.reportId}::uuid,
      p_account_id          => ${args.accountId}::uuid,
      p_client_id           => ${args.clientId}::uuid,
      p_reviewed_version_id => ${args.reviewedVersionId}::uuid
    ) as result
  `
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows[0].result as any
}

async function revoke(args: { accountId: string; clientId: string; reportId: string }) {
  const rows = await sql`
    select revoke_client_report(
      p_report_id  => ${args.reportId}::uuid,
      p_account_id => ${args.accountId}::uuid,
      p_client_id  => ${args.clientId}::uuid
    ) as result
  `
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows[0].result as any
}

async function rotate(args: { accountId: string; clientId: string; reportId: string }) {
  const rows = await sql`
    select rotate_client_report_link(
      p_report_id  => ${args.reportId}::uuid,
      p_account_id => ${args.accountId}::uuid,
      p_client_id  => ${args.clientId}::uuid
    ) as result
  `
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows[0].result as any
}

// The exact query shape lib/reports/store.ts's resolvePublicClientReport
// runs — a revoked report, a report at a stale share_version, and a slug
// that never existed must all resolve to zero rows identically.
async function publicResolve(slug: string, shareVersion: number) {
  const rows = await sql`
    select id, published_version_id from client_reports
    where public_slug = ${slug} and share_version = ${shareVersion} and status = 'published'
    limit 1
  `
  return rows[0] ?? null
}

function snapshot(summary: string) {
  return { snapshotSchemaVersion: 1, executiveSummary: summary }
}

describe('client report lifecycle functions, called with named arguments', () => {
  beforeEach(seed)

  it('creates a report with its first version, unpublished', async () => {
    const clientId = await seedClient(ACCOUNT, DOMAIN)
    const scanId = await seedScan(ACCOUNT, DOMAIN, 80, '2026-07-20T00:00:00.000Z')

    const result = await createReport({
      accountId: ACCOUNT, clientId, sourceScanId: scanId, previousScanId: null,
      locale: 'en', executiveSummary: 'First version summary', snapshot: snapshot('v1'), createdBy: null,
    })

    expect(result.report).toMatchObject({
      account_id: ACCOUNT, client_id: clientId, status: 'draft', published_version_id: null,
    })
    expect(result.version).toMatchObject({ version_number: 1, executive_summary: 'First version summary' })
    expect(result.report.latest_version_id).toBe(result.version.id)
  })

  it('rejects a source scan for a different domain than the client', async () => {
    const clientId = await seedClient(ACCOUNT, DOMAIN)
    const otherScanId = await seedScan(ACCOUNT, 'not-the-client-domain.example', 80, '2026-07-20T00:00:00.000Z')

    await expect(createReport({
      accountId: ACCOUNT, clientId, sourceScanId: otherScanId, previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshot: snapshot('v1'), createdBy: null,
    })).rejects.toThrow(/CLIENT_REPORT_SCAN_NOT_FOUND/)
  })

  it('publishing points published_version_id at the latest reviewed version', async () => {
    const clientId = await seedClient(ACCOUNT, DOMAIN)
    const scanId = await seedScan(ACCOUNT, DOMAIN, 80, '2026-07-20T00:00:00.000Z')
    const created = await createReport({
      accountId: ACCOUNT, clientId, sourceScanId: scanId, previousScanId: null,
      locale: 'en', executiveSummary: 'Published summary', snapshot: snapshot('v1'), createdBy: null,
    })

    const published = await publish({
      accountId: ACCOUNT, clientId, reportId: created.report.id, reviewedVersionId: created.version.id,
    })
    expect(published.report).toMatchObject({ status: 'published', published_version_id: created.version.id })
    expect(published.published_version.executive_summary).toBe('Published summary')

    const v1Rows = await sql`select executive_summary from client_report_versions where id = ${created.version.id}`
    expect(v1Rows[0].executive_summary).toBe('Published summary')
  })

  // FINDING, not a store.ts bug: append_client_report_version's body computes
  // its next version_number with `pg_catalog.coalesce(pg_catalog.max(...) + 1,
  // 1)`. COALESCE is a parser-level special form, not a real pg_proc entry —
  // unlike aggregates such as pg_catalog.max() or pg_catalog.now(), it has no
  // schema-qualified form on this Neon Postgres (18.4), so the qualified call
  // fails with "function pg_catalog.coalesce(integer, integer) does not
  // exist" on every invocation, unconditionally. Confirmed directly: bare
  // `coalesce(1,2)` succeeds, `pg_catalog.coalesce(1,2)` does not. The same
  // pattern appears in increment_client_report_view (027 line ~804), which is
  // covered separately below. lib/reports/store.ts's named-argument call is
  // correct — appendClientReportVersion reaches this line and the function
  // itself throws before returning. This is supabase/migrations/027, which
  // this task is not permitted to modify; a follow-up must patch both
  // occurrences (drop the `pg_catalog.` prefix — COALESCE needs none) and
  // this test should then be rewritten to assert success and immutability.
  it('appendClientReportVersion currently fails — migration 027 calls pg_catalog.coalesce, which does not exist', async () => {
    const clientId = await seedClient(ACCOUNT, DOMAIN)
    const scanId = await seedScan(ACCOUNT, DOMAIN, 80, '2026-07-20T00:00:00.000Z')
    const created = await createReport({
      accountId: ACCOUNT, clientId, sourceScanId: scanId, previousScanId: null,
      locale: 'en', executiveSummary: 'Published summary', snapshot: snapshot('v1'), createdBy: null,
    })
    await publish({ accountId: ACCOUNT, clientId, reportId: created.report.id, reviewedVersionId: created.version.id })

    const laterScanId = await seedScan(ACCOUNT, DOMAIN, 85, '2026-07-21T00:00:00.000Z')
    await expect(appendVersion({
      accountId: ACCOUNT, clientId, reportId: created.report.id,
      sourceScanId: laterScanId, previousScanId: scanId,
      locale: 'en', executiveSummary: 'Second version summary', snapshot: snapshot('v2'), createdBy: null,
    })).rejects.toThrow(/pg_catalog\.coalesce\(integer, integer\) does not exist/)

    // Because the append never committed, the published version is
    // (trivially, but truthfully) still unmutated.
    const v1Rows = await sql`select executive_summary from client_report_versions where id = ${created.version.id}`
    expect(v1Rows[0].executive_summary).toBe('Published summary')
  })

  // Same pg_catalog.coalesce defect, a second occurrence (027 line ~804:
  // `first_viewed_at = pg_catalog.coalesce(client_reports.first_viewed_at,
  // pg_catalog.now())`). lib/reports/store.ts's incrementClientReportView
  // wraps this exact call in a try/catch that swallows any error — this
  // proves that design choice is load-bearing today, not defensive
  // boilerplate: without it, a public report viewer would get a 500 purely
  // because the view counter is broken. cta_click has no coalesce call and
  // increments normally, confirmed against the same report row.
  it('increment_client_report_view fails on the same pg_catalog.coalesce defect; increment_client_report_cta_click is unaffected', async () => {
    const clientId = await seedClient(ACCOUNT, DOMAIN)
    const scanId = await seedScan(ACCOUNT, DOMAIN, 80, '2026-07-20T00:00:00.000Z')
    const created = await createReport({
      accountId: ACCOUNT, clientId, sourceScanId: scanId, previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshot: snapshot('v1'), createdBy: null,
    })
    const published = await publish({
      accountId: ACCOUNT, clientId, reportId: created.report.id, reviewedVersionId: created.version.id,
    })
    const slug = published.report.public_slug as string
    const shareVersion = published.report.share_version as number

    await expect(sql`
      select increment_client_report_view(p_public_slug => ${slug}, p_share_version => ${shareVersion}::int)
    `).rejects.toThrow(/pg_catalog\.coalesce\(.*\) does not exist/)
    const afterView = await sql`select view_count from client_reports where id = ${created.report.id}`
    expect(Number(afterView[0].view_count)).toBe(0)

    await sql`select increment_client_report_cta_click(p_public_slug => ${slug}, p_share_version => ${shareVersion}::int)`
    const afterCta = await sql`select cta_click_count from client_reports where id = ${created.report.id}`
    expect(Number(afterCta[0].cta_click_count)).toBe(1)
  })

  it('revoking rotates the public link so the old slug/version resolves to nothing — indistinguishable from a slug that never existed', async () => {
    const clientId = await seedClient(ACCOUNT, DOMAIN)
    const scanId = await seedScan(ACCOUNT, DOMAIN, 80, '2026-07-20T00:00:00.000Z')
    const created = await createReport({
      accountId: ACCOUNT, clientId, sourceScanId: scanId, previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshot: snapshot('v1'), createdBy: null,
    })
    const published = await publish({
      accountId: ACCOUNT, clientId, reportId: created.report.id, reviewedVersionId: created.version.id,
    })
    const oldSlug = published.report.public_slug as string
    const oldShareVersion = published.report.share_version as number

    // Confirm the published link resolves before revoking, so the later
    // "zero rows" assertion actually proves revocation, not a query bug.
    expect(await publicResolve(oldSlug, oldShareVersion)).not.toBeNull()

    const revoked = await revoke({ accountId: ACCOUNT, clientId, reportId: created.report.id })
    expect(revoked.report.status).toBe('revoked')
    expect(revoked.report.public_slug).not.toBe(oldSlug)

    const resolvedOldLink = await publicResolve(oldSlug, oldShareVersion)
    const resolvedNeverIssued = await publicResolve('z'.repeat(32), 1)
    expect(resolvedOldLink).toBeNull()
    expect(resolvedNeverIssued).toBeNull()
  })

  it('rotating a published link changes the slug without changing the published content', async () => {
    const clientId = await seedClient(ACCOUNT, DOMAIN)
    const scanId = await seedScan(ACCOUNT, DOMAIN, 80, '2026-07-20T00:00:00.000Z')
    const created = await createReport({
      accountId: ACCOUNT, clientId, sourceScanId: scanId, previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshot: snapshot('v1'), createdBy: null,
    })
    const published = await publish({
      accountId: ACCOUNT, clientId, reportId: created.report.id, reviewedVersionId: created.version.id,
    })
    const oldSlug = published.report.public_slug as string

    const rotated = await rotate({ accountId: ACCOUNT, clientId, reportId: created.report.id })

    expect(rotated.report.public_slug).not.toBe(oldSlug)
    expect(rotated.published_version.id).toBe(created.version.id)
    expect(await publicResolve(oldSlug, published.report.share_version as number)).toBeNull()
    expect(await publicResolve(rotated.report.public_slug, rotated.report.share_version)).not.toBeNull()
  })

  it('refuses to load or mutate a report belonging to a different account', async () => {
    const clientId = await seedClient(ACCOUNT, DOMAIN)
    const scanId = await seedScan(ACCOUNT, DOMAIN, 80, '2026-07-20T00:00:00.000Z')
    const created = await createReport({
      accountId: ACCOUNT, clientId, sourceScanId: scanId, previousScanId: null,
      locale: 'en', executiveSummary: 'Summary', snapshot: snapshot('v1'), createdBy: null,
    })

    // The same read lib/reports/store.ts's loadOwnedClientReportById runs,
    // scoped to the wrong account.
    const rows = await sql`
      select id from client_reports where account_id = ${OTHER} and id = ${created.report.id}
    `
    expect(rows).toHaveLength(0)

    // The SECURITY DEFINER functions enforce the same boundary independently
    // of any application-level filter.
    await expect(revoke({ accountId: OTHER, clientId, reportId: created.report.id }))
      .rejects.toThrow(/CLIENT_REPORT_NOT_FOUND/)
  })
})
