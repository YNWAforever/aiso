import { beforeEach, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', async () => {
  const { neon: connect } = await import('@neondatabase/serverless')
  return { db: () => connect(process.env.TEST_DATABASE_URL!) }
})
const getProfileMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))

const sql = neon(process.env.TEST_DATABASE_URL!)

/**
 * AC-12 for client reports and brand entities: no cross-account read or
 * mutation, executed through the layers the routes actually call.
 *
 * What already existed stopped short of that. client-reports.test.ts proves the
 * SECURITY DEFINER functions refuse a foreign account and that a hand-written
 * SELECT scoped to the wrong account is empty — but never runs the store
 * functions or the service that the report routes delegate to, and those are
 * where "grep says it's ungated" lives (CLAUDE.md: read the callee). The entity
 * suite is an excluded C9 file covering load and first save only. This file runs
 * the real service and store as account B against account A's ids, then reads
 * A's rows back. Each denial has an as-A control, so a missing fixture cannot
 * pass as a refusal.
 *
 * Fixtures are keyed to this file; setup.ts shares one branch across the run.
 */

const A = 'c1300000-0000-4000-8000-00000000000a'
const B = 'c1300000-0000-4000-8000-00000000000b'
const A_CLIENT = 'c1300000-0000-4000-8000-0000000000a1'
const B_CLIENT = 'c1300000-0000-4000-8000-0000000000b1'
const A_SCAN = 'c1300000-0000-4000-8000-0000000000a2'
const A_USER = 'c1300000-0000-4000-8000-0000000000a9'
const B_USER = 'c1300000-0000-4000-8000-0000000000b9'
const A_DOMAIN = 'tenant-a-c13.example'

let aReport: { id: string; versionId: string }

async function teardown() {
  await sql`delete from client_reports where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from client_report_versions where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from account_report_branding where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from client_domain_verifications where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from client_entities where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from scans where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from clients where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from profiles where id in (${A_USER}::uuid, ${B_USER}::uuid)`
  await sql`delete from neon_auth.user where id in (${A_USER}, ${B_USER})`
  await sql`delete from accounts where id in (${A}::uuid, ${B}::uuid)`
}

async function signedInAs(account: string) {
  const [row] = await sql`select * from accounts where id = ${account}::uuid`
  getProfileMock.mockResolvedValue({
    id: account === A ? A_USER : B_USER, account_id: account, is_admin: false, accounts: row,
  })
}

beforeEach(async () => {
  // Listing a published report signs its share link, which needs this secret.
  process.env.REPORT_SHARE_SECRET ??= 'reports-entities-tenancy-integration-secret-0123'
  getProfileMock.mockReset()
  await teardown()
  // Both on a plan that includes online client reports, so the entitlement gate
  // lets B through and every refusal below is ownership, not plan.
  for (const [account, client, domain, user] of [
    [A, A_CLIENT, A_DOMAIN, A_USER], [B, B_CLIENT, 'tenant-b-c13.example', B_USER],
  ]) {
    // The subscription id is the whole uuid, not a suffix: every integration
    // file shares one branch, and stripe_subscription_id is unique
    // account-wide, so a short suffix collides with another suite's fixture
    // that happens to end the same way.
    await sql`
      insert into accounts (id, plan, status, stripe_subscription_id)
      values (${account}::uuid, 'pro', 'active', ${'sub_' + account})
    `
    // Real members: branding (027) and verification tokens (053) record their
    // actor through a composite FK to profiles(id, account_id).
    await sql`
      insert into neon_auth.user (id, email, name, "emailVerified")
      values (${user}, ${'member-' + user.slice(-2) + '@example.com'}, 'Fixture', true)
    `
    await sql`insert into profiles (id, account_id, display_name) values (${user}::uuid, ${account}::uuid, 'Member')`
    await sql`
      insert into clients (id, account_id, brand_name, status, competitors, domain)
      values (${client}::uuid, ${account}::uuid, 'Tenant', 'active', ${[]}::text[], ${domain})
    `
  }
  await sql`
    insert into scans (id, url, domain, score, results, account_id, client_id)
    values (${A_SCAN}::uuid, ${'https://' + A_DOMAIN}, ${A_DOMAIN}, 80, ${'{}'}::jsonb, ${A}::uuid, ${A_CLIENT}::uuid)
  `
  const [created] = await sql`
    select create_client_report_with_version(
      p_account_id => ${A}::uuid, p_client_id => ${A_CLIENT}::uuid,
      p_source_scan_id => ${A_SCAN}::uuid, p_previous_scan_id => ${null}::uuid,
      p_locale => 'en', p_executive_summary => 'Tenant A summary',
      p_snapshot_schema_version => 1,
      p_snapshot => ${JSON.stringify({ snapshotSchemaVersion: 1, executiveSummary: 'Tenant A summary' })}::jsonb,
      p_created_by => ${null}::uuid
    ) as result
  `
  const { report, version } = created.result as { report: { id: string }; version: { id: string } }
  await sql`
    select publish_client_report_latest(
      p_report_id => ${report.id}::uuid, p_account_id => ${A}::uuid,
      p_client_id => ${A_CLIENT}::uuid, p_reviewed_version_id => ${version.id}::uuid
    ) as result
  `
  aReport = { id: report.id, versionId: version.id }
  await sql`
    insert into account_report_branding (account_id, agency_name, primary_color)
    values (${A}::uuid, 'Agency A', '#112233')
  `
  await sql`
    insert into client_entities (client_id, account_id, display_name, aliases, revision)
    values (${A_CLIENT}::uuid, ${A}::uuid, 'Tenant A Brand', ${'["TAB"]'}::jsonb, 1)
  `
  await signedInAs(B)
})

async function aReportState() {
  const [row] = await sql`
    select status, public_slug, share_version, published_version_id
    from client_reports where id = ${aReport.id}::uuid
  `
  return row
}

describe('client reports service, as account B against account A', () => {
  it('lists none of A\'s reports under A\'s client id', async () => {
    const { listAuthenticatedClientReports } = await import('@/lib/reports/service')
    await expect(listAuthenticatedClientReports(A_CLIENT)).rejects.toMatchObject({ code: 'not_found' })

    await signedInAs(A)
    const { reports } = await listAuthenticatedClientReports(A_CLIENT)
    expect(reports).toHaveLength(1)
  })

  it.each([
    ['revoke', 'revokeAuthenticatedClientReport'],
    ['rotate', 'rotateAuthenticatedClientReportLink'],
  ] as const)('cannot %s A\'s published report, and its public link is untouched', async (_verb, fn) => {
    const service = await import('@/lib/reports/service')
    const before = await aReportState()
    expect(before.status).toBe('published')
    await expect(service[fn](aReport.id)).rejects.toMatchObject({ code: 'not_found' })
    expect(await aReportState()).toEqual(before)
  })

  it('cannot publish A\'s report, even naming A\'s real version id', async () => {
    const { publishAuthenticatedClientReport } = await import('@/lib/reports/service')
    const before = await aReportState()
    await expect(publishAuthenticatedClientReport(aReport.id, aReport.versionId))
      .rejects.toMatchObject({ code: 'not_found' })
    expect(await aReportState()).toEqual(before)
  })
})

describe('client reports store, as account B against account A', () => {
  it('reads nothing of A by report id, by client and report, or by version', async () => {
    const store = await import('@/lib/reports/store')
    expect(await store.loadOwnedClientReportById({ accountId: B, reportId: aReport.id })).toBeNull()
    expect(await store.loadOwnedClientReport({ accountId: B, clientId: A_CLIENT, reportId: aReport.id })).toBeNull()
    expect(await store.listClientReports({ accountId: B, clientId: A_CLIENT })).toEqual([])
    expect(await store.listClientReportVersions({ accountId: B, clientId: A_CLIENT, reportId: aReport.id }))
      .toEqual([])
    expect(await store.loadOwnedReportClient({ accountId: B, clientId: A_CLIENT })).toBeNull()
    // Control.
    expect(await store.loadOwnedClientReportById({ accountId: A, reportId: aReport.id })).not.toBeNull()
    expect(await store.listClientReportVersions({ accountId: A, clientId: A_CLIENT, reportId: aReport.id }))
      .toHaveLength(1)
  })

  it('cannot append a version to A\'s report, with A\'s own scan as the source', async () => {
    const { appendClientReportVersion } = await import('@/lib/reports/store')
    await expect(appendClientReportVersion({
      reportId: aReport.id, accountId: B, clientId: A_CLIENT, sourceScanId: A_SCAN, previousScanId: null,
      locale: 'en', executiveSummary: 'Written by B', snapshotSchemaVersion: 1,
      snapshot: { snapshotSchemaVersion: 1, executiveSummary: 'Written by B' }, createdBy: B_USER,
    } as never)).rejects.toThrow()
    const versions = await sql`select id from client_report_versions where report_id = ${aReport.id}::uuid`
    expect(versions).toHaveLength(1)
  })
})

describe('report branding, as account B', () => {
  it('reads none of A\'s branding, and writing its own leaves A\'s untouched', async () => {
    const service = await import('@/lib/reports/service')
    expect(await service.getAuthenticatedReportBranding()).toEqual({ branding: null })

    await service.putAuthenticatedReportBranding({
      agencyName: 'Agency B', logoUrl: null, primaryColor: '#445566', contactLabel: null, contactUrl: null,
    })
    const rows = await sql`
      select account_id, agency_name, primary_color from account_report_branding
      where account_id in (${A}::uuid, ${B}::uuid) order by agency_name
    `
    expect(rows).toEqual([
      { account_id: A, agency_name: 'Agency A', primary_color: '#112233' },
      { account_id: B, agency_name: 'Agency B', primary_color: '#445566' },
    ])

    await signedInAs(A)
    expect((await service.getAuthenticatedReportBranding()).branding?.agencyName).toBe('Agency A')
  })
})

describe('brand entities, as account B against account A', () => {
  const body = (expectedRevision: number) => new Request('http://localhost/', {
    method: 'PUT',
    body: JSON.stringify({ displayName: 'Renamed by B', aliases: [], expectedRevision }),
  })

  it('cannot load A\'s entity page', async () => {
    const { loadAuthenticatedEntityPage } = await import('@/lib/entities/service')
    await expect(loadAuthenticatedEntityPage(A_CLIENT)).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' })

    await signedInAs(A)
    const page = await loadAuthenticatedEntityPage(A_CLIENT)
    expect(page.entity?.displayName).toBe('Tenant A Brand')
  })

  it.each([0, 1])('cannot overwrite A\'s entity (expectedRevision %i)', async expectedRevision => {
    // 0 is the create path (insert ... on conflict do nothing), 1 the update path
    // at A's real revision — the one the C9 suite never ran as another account.
    const { saveAuthenticatedEntity } = await import('@/lib/entities/service')
    await expect(saveAuthenticatedEntity(A_CLIENT, body(expectedRevision)))
      .rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' })
    const [row] = await sql`select display_name, revision from client_entities where client_id = ${A_CLIENT}::uuid`
    expect(row).toEqual({ display_name: 'Tenant A Brand', revision: 1 })
  })

  it('the store refuses the update path directly, below the service guard', async () => {
    const { saveEntity } = await import('@/lib/entities/store')
    expect(await saveEntity(B, A_CLIENT, B_USER, { displayName: 'Renamed by B', aliases: [], expectedRevision: 1 }))
      .toBeNull()
    const [row] = await sql`select display_name, revision from client_entities where client_id = ${A_CLIENT}::uuid`
    expect(row).toEqual({ display_name: 'Tenant A Brand', revision: 1 })
  })
})

describe('domain verification, as account B against account A', () => {
  it('cannot read A\'s verification state, and mints no token on A\'s client', async () => {
    const { readDomainVerification } = await import('@/lib/domain-verification/service')
    expect((await readDomainVerification(A_CLIENT)).status).toBe(404)
    expect(await sql`select 1 from client_domain_verifications where client_id = ${A_CLIENT}::uuid`).toHaveLength(0)

    // Control: A's own read mints the token.
    await signedInAs(A)
    const res = await readDomainVerification(A_CLIENT)
    expect(res.status).toBe(200)
    expect((await res.json() as { token: string | null }).token).toBeTruthy()
  })

  it('cannot trigger a verification check against A\'s domain', async () => {
    const { checkDomainVerification } = await import('@/lib/domain-verification/service')
    expect((await checkDomainVerification(A_CLIENT)).status).toBe(404)
    expect(await sql`select 1 from client_domain_verifications where client_id = ${A_CLIENT}::uuid`).toHaveLength(0)
  })
})
