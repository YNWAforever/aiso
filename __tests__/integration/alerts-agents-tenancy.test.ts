import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { runAlertEvaluation, type AlertEmailInput } from '@/lib/alerts/evaluate'
import { createNeonAlertStore } from '@/lib/alerts/neon-store'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', async () => {
  const { neon: connect } = await import('@neondatabase/serverless')
  return { db: () => connect(process.env.TEST_DATABASE_URL!) }
})
const getProfileMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))

const sql = neon(process.env.TEST_DATABASE_URL!)

/**
 * AC-12 for alerts and the agent tables — the two the tenancy inventory
 * declares UNSCOPED, and the last two the row named as unproven.
 *
 * Neither is a session-scoped read, so "B reads A" is the wrong question. Both
 * are cron-authenticated and deliberately account-blind, and both sit on tables
 * with NO account_id of their own: `alert_configs` keys on client_id, and the
 * three `agent_*` tables key on scan_id. Tenancy is therefore entirely a
 * property of a JOIN, which is exactly the kind of thing that is correct in
 * review and wrong in execution. Two distinct properties are proven here:
 *
 *  1. Alert evaluation — which legitimately reads EVERY account in one pass —
 *     must deliver each account's numbers only to that account. A mis-joined
 *     email is a cross-account export of one owner's visibility score to
 *     another, and it would look like working software from both ends.
 *  2. A caller holding the cron secret still cannot cross the client/scan
 *     boundary: naming A's scan under B's client writes nothing.
 *
 * Plus the one genuinely session-scoped surface, the alerts config route.
 *
 * Fixtures are keyed to this file; setup.ts shares one branch across the run.
 */

const A = 'c1400000-0000-4000-8000-00000000000a'
const B = 'c1400000-0000-4000-8000-00000000000b'
const A_CLIENT = 'c1400000-0000-4000-8000-0000000000a1'
const B_CLIENT = 'c1400000-0000-4000-8000-0000000000b1'
const A_SCAN = 'c1400000-0000-4000-8000-0000000000a2'
const B_SCAN = 'c1400000-0000-4000-8000-0000000000b2'
const A_USER = 'c1400000-0000-4000-8000-0000000000a9'
const B_USER = 'c1400000-0000-4000-8000-0000000000b9'
const A_EMAIL = 'owner-a-c14@example.com'
const B_EMAIL = 'owner-b-c14@example.com'
const CRON = 'c14-cron-secret-long-enough'

// Each account's own score, far enough apart that a delivered number names its
// account unambiguously. Both are below the threshold, so both alert.
//
// The rollup row the evaluator reads is the ALL-PLATFORM one (`platform is
// null`), and agent rows are filtered against the plan's platform_access —
// 'gpt4o' is on Pro's list, 'chatgpt' is not, so a per-platform row or an
// off-list platform makes these suites pass vacuously.
const A_SOV = 11
const B_SOV = 22
const THRESHOLD = 50

async function currentScanWeek(): Promise<string> {
  const [row] = await sql`select date_trunc('week', now())::date::text as week`
  return row.week as string
}

async function teardown() {
  await sql`delete from agent_recommendations where scan_id in (${A_SCAN}::uuid, ${B_SCAN}::uuid)`
  await sql`delete from notifications where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from alert_email_deliveries where client_id in (${A_CLIENT}::uuid, ${B_CLIENT}::uuid)`
  await sql`delete from alert_configs where client_id in (${A_CLIENT}::uuid, ${B_CLIENT}::uuid)`
  await sql`delete from pulse_weekly_summary where client_id in (${A_CLIENT}::uuid, ${B_CLIENT}::uuid)`
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
  process.env.CRON_SECRET = CRON
  getProfileMock.mockReset()
  await teardown()
  const week = await currentScanWeek()

  for (const [account, client, scan, user, email, sov] of [
    [A, A_CLIENT, A_SCAN, A_USER, A_EMAIL, A_SOV],
    [B, B_CLIENT, B_SCAN, B_USER, B_EMAIL, B_SOV],
  ] as Array<[string, string, string, string, string, number]>) {
    // The subscription id is the whole uuid: every integration file shares one
    // branch and stripe_subscription_id is unique account-wide.
    await sql`
      insert into accounts (id, plan, status, stripe_subscription_id)
      values (${account}::uuid, 'pro', 'active', ${'sub_' + account})
    `
    await sql`
      insert into neon_auth.user (id, email, name, "emailVerified")
      values (${user}, ${email}, 'Owner', true)
    `
    await sql`insert into profiles (id, account_id, display_name) values (${user}::uuid, ${account}::uuid, 'Owner')`
    await sql`
      insert into clients (id, account_id, brand_name, status, competitors, domain)
      values (${client}::uuid, ${account}::uuid, ${'Brand ' + account.slice(-1)}, 'active', ${[]}::text[],
              ${account.slice(-1) + '-c14.example'})
    `
    await sql`
      insert into scans (id, url, domain, score, results, account_id, client_id)
      values (${scan}::uuid, 'https://c14.example', 'c14.example', 70, ${'{}'}::jsonb,
              ${account}::uuid, ${client}::uuid)
    `
    await sql`
      insert into alert_configs (client_id, enabled_sov, sov_threshold, enabled_wow, notify_email, notify_inapp)
      values (${client}::uuid, true, ${THRESHOLD}, false, true, true)
    `
    await sql`
      insert into pulse_weekly_summary (client_id, scan_week, platform, total_queries, brand_mentions, sov_score)
      values (${client}::uuid, ${week}::date, null, 10, 1, ${sov})
    `
  }
})

describe('alert evaluation across two accounts, on real rows', () => {
  it('delivers each account\'s score only to that account', async () => {
    const emails: AlertEmailInput[] = []
    const result = await runAlertEvaluation({
      ...createNeonAlertStore(sql),
      sendAlertEmail: async email => { emails.push(email) },
    })

    expect(result.evaluated).toBe(2)
    expect(result.fired).toBe(2)
    expect(result.emailFailures + result.notificationFailures).toBe(0)

    // The export half: one email each, carrying its own account's number, to
    // its own account's member. A mis-joined recipient or score here is a
    // cross-account export that both owners would read as working software.
    const byRecipient = Object.fromEntries(emails.map(email => [email.to, email]))
    expect(Object.keys(byRecipient).sort()).toEqual([A_EMAIL, B_EMAIL].sort())
    expect(byRecipient[A_EMAIL]).toMatchObject({ clientId: A_CLIENT, currentSov: A_SOV })
    expect(byRecipient[B_EMAIL]).toMatchObject({ clientId: B_CLIENT, currentSov: B_SOV })

    // The write half: notifications and the delivery ledger both land on the
    // owning account. `alert_configs` has no account_id, so the account on
    // these rows can only have come from the join to clients.
    const notifications = await sql`
      select account_id, client_id from notifications
      where account_id in (${A}::uuid, ${B}::uuid) order by account_id
    `
    expect(notifications).toEqual([
      { account_id: A, client_id: A_CLIENT },
      { account_id: B, client_id: B_CLIENT },
    ])
    const deliveries = await sql`
      select client_id, recipient from alert_email_deliveries
      where client_id in (${A_CLIENT}::uuid, ${B_CLIENT}::uuid) order by recipient
    `
    expect(deliveries).toEqual([
      { client_id: A_CLIENT, recipient: A_EMAIL },
      { client_id: B_CLIENT, recipient: B_EMAIL },
    ])
  })

  it('one account\'s delivery never suppresses another\'s', async () => {
    // The ledger's key is (client_id, type, scan_week) with no account in it.
    // Claim A's row first: B must still be delivered, and A must not be twice.
    const week = await currentScanWeek()
    await sql`
      insert into alert_email_deliveries (client_id, type, scan_week, recipient)
      values (${A_CLIENT}::uuid, 'sov_threshold', ${week}::date, ${A_EMAIL})
    `
    const emails: AlertEmailInput[] = []
    const result = await runAlertEvaluation({
      ...createNeonAlertStore(sql),
      sendAlertEmail: async email => { emails.push(email) },
    })

    expect(emails.map(email => email.to)).toEqual([B_EMAIL])
    expect(result.evaluated).toBe(2)
  })
})

describe('alerts configuration route, as account B against account A', () => {
  const params = (clientId: string) => ({ params: Promise.resolve({ clientId }) })
  const put = () => new Request('http://localhost/', {
    method: 'PUT',
    body: JSON.stringify({ enabled_sov: false, sov_threshold: 99, enabled_wow: true, wow_threshold: 1 }),
  })

  it('cannot read A\'s alert configuration', async () => {
    await signedInAs(B)
    const { GET } = await import('@/app/api/dashboard/clients/[clientId]/alerts/route')
    expect((await GET(new Request('http://localhost/'), params(A_CLIENT))).status).toBe(404)

    await signedInAs(A)
    const res = await GET(new Request('http://localhost/'), params(A_CLIENT))
    expect(res.status).toBe(200)
    expect((await res.json() as { config: { sov_threshold: number } }).config.sov_threshold).toBe(THRESHOLD)
  })

  it('cannot rewrite A\'s alert configuration', async () => {
    await signedInAs(B)
    const { PUT } = await import('@/app/api/dashboard/clients/[clientId]/alerts/route')
    expect((await PUT(put(), params(A_CLIENT))).status).toBe(404)
    const [row] = await sql`
      select enabled_sov, sov_threshold, enabled_wow from alert_configs where client_id = ${A_CLIENT}::uuid
    `
    expect(row).toEqual({ enabled_sov: true, sov_threshold: THRESHOLD, enabled_wow: false })
  })
})

describe('agent callback routes, holding the cron secret', () => {
  const payload = () => ({
    scanId: A_SCAN,
    recommendations: [{
      platform: 'gpt4o', priority: 'high', recommendation: 'Written across the boundary',
      category: 'content', impactScore: 9,
    }],
  })
  const post = (body: unknown) => new NextRequest('http://localhost/', {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-cron-secret': CRON },
  })

  it('cannot write A\'s scan under B\'s client, even with a valid secret', async () => {
    const { POST } = await import('@/app/api/clients/[clientId]/agents/recommendations/route')
    const res = await POST(post(payload()), { params: Promise.resolve({ clientId: B_CLIENT }) })
    expect(res.status).toBe(404)
    expect(await sql`select id from agent_recommendations where scan_id = ${A_SCAN}::uuid`).toHaveLength(0)
    const [scan] = await sql`select agent_status from scans where id = ${A_SCAN}::uuid`
    expect(scan.agent_status).not.toBe('running')

    // Control: the matching pair writes, so the 404 above is the mismatch.
    const ok = await POST(post(payload()), { params: Promise.resolve({ clientId: A_CLIENT }) })
    expect(ok.status).toBe(200)
    expect(await sql`select id from agent_recommendations where scan_id = ${A_SCAN}::uuid`).toHaveLength(1)
  })

  it('refuses without the secret, before looking anything up', async () => {
    const { POST } = await import('@/app/api/clients/[clientId]/agents/recommendations/route')
    const res = await POST(
      new NextRequest('http://localhost/', { method: 'POST', body: JSON.stringify(payload()) }),
      { params: Promise.resolve({ clientId: A_CLIENT }) },
    )
    expect(res.status).toBe(401)
    expect(await sql`select id from agent_recommendations where scan_id = ${A_SCAN}::uuid`).toHaveLength(0)
  })

  it('never surfaces A\'s agent rows in B\'s workspace', async () => {
    // agent_recommendations has no account_id — the workspace read reaches it
    // only through scans, so this join IS the tenancy boundary.
    await sql`
      insert into agent_recommendations (scan_id, platform, priority, recommendation, category, impact_score)
      values (${A_SCAN}::uuid, 'gpt4o', 'high', 'Tenant A recommendation', 'content', 9)
    `
    const { loadOwnedWorkspace } = await import('@/lib/workspace/load-owned-workspace')
    const [bAccount] = await sql`select * from accounts where id = ${B}::uuid`
    const [aAccount] = await sql`select * from accounts where id = ${A}::uuid`

    // B asking for A's client gets nothing at all.
    expect(await loadOwnedWorkspace({ clientId: A_CLIENT, profile: { account_id: B, accounts: bAccount } }))
      .toBeNull()

    // B's own workspace carries none of A's rows, and B cannot pull A's scan
    // into it by naming that scan id explicitly.
    const own = await loadOwnedWorkspace({
      clientId: B_CLIENT, profile: { account_id: B, accounts: bAccount }, scanId: A_SCAN,
    })
    expect(own?.scan.data).toBeNull()
    expect(own?.recommendations.data).toEqual([])

    // Control: A sees its own recommendation.
    const mine = await loadOwnedWorkspace({
      clientId: A_CLIENT, profile: { account_id: A, accounts: aAccount }, scanId: A_SCAN,
    })
    expect(mine?.recommendations.data.map(row => row.recommendation)).toEqual(['Tenant A recommendation'])
  })
})
