import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { neon } from '@neondatabase/serverless'
import { assertApprovedTarget } from './approved-target'
import {
  TENANCY_TARGET_VARIABLES,
  approvedTenancyTarget,
  assertDisposableTenancyTarget,
} from './tenancy-target'
import { provisionAccountForUser } from '@/app/api/webhooks/neon/route'
import { CLAIM_INTENT_COOKIE, signScanClaimIntent } from '@/lib/security/scan-claim-intent'
import { buildScanEvidence, describeEvidenceUrl, CHECK_VERSIONS, type EvidenceCheckKey } from '@/lib/scan-evidence'
import { resolveCommercialEntitlement, type CommercialAccount } from '@/lib/tier'
import { MAX_PRIORITIES } from '@/lib/view-models/owner-priorities'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', async () => {
  const { neon: connect } = await import('@neondatabase/serverless')
  return { db: () => connect(process.env.TEST_DATABASE_URL!) }
})
const getProfileMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth', () => ({ getProfile: getProfileMock }))
// The one thing not real: seeding the question bank calls an LLM.
vi.mock('@/lib/openrouter', () => ({
  callOpenRouter: vi.fn().mockResolvedValue(JSON.stringify([
    { category: 'brand_query', question: 'What is First Run Co?', language: 'en' },
    { category: 'category_query', question: 'Best bakery in Kowloon?', language: 'en' },
    { category: 'intent_query', question: 'Where can I order a cake today?', language: 'en' },
    { category: 'pain_point', question: 'Why are cake deliveries late?', language: 'en' },
    { category: 'invented', question: 'Dropped: not in the vocabulary', language: 'en' },
  ])),
}))

const sql = neon(process.env.TEST_DATABASE_URL!)

/**
 * AC-01, against real Postgres: a new owner gets a real baseline and
 * understands three priorities.
 *
 * Every piece was unit-tested with the database mocked. What no test showed is
 * that they join up on real rows: that an owner freshly provisioned by the
 * webhook, holding the claim cookie for the scan they just ran, can complete
 * onboarding and land on a Home whose priorities come from THAT scan, with the
 * activation funnel reading the milestones the journey actually wrote.
 *
 * It also pins a fact AC-14's live run surfaced: a freshly provisioned owner is
 * entitled to nothing (`free`) until onboarding starts the trial.
 *
 * Not covered: the browser. CI's E2E runs under E2E_FIXTURE_MODE with
 * getProfile() null, so this is the deepest the journey goes in CI.
 *
 * Run through scripts/ci/run-exact-target-suites.mjs, which provisions one
 * disposable branch for every exact-target suite and derives this suite's
 * C9F_TENANCY_* approval from it. Fixtures are keyed to this file.
 */

const USER = 'c1000000-0000-4000-8000-000000000001'
const STRANGER = 'c1000000-0000-4000-8000-000000000002'
const SCAN = 'c1000000-0000-4000-8000-000000000003'
const USER_EMAIL = 'first-run-c1@example.com'
const STRANGER_EMAIL = 'stranger-c1@example.com'

const KEYS = Object.keys(CHECK_VERSIONS) as EvidenceCheckKey[]
// Four observed failures and one blocked check: the owner sees at most three,
// and never the one nobody could observe.
const FAILING: EvidenceCheckKey[] = KEYS.slice(0, 4)
const BLOCKED: EvidenceCheckKey = KEYS[4]

function evidence() {
  return buildScanEvidence({
    requestedUrl: 'https://first-run.example',
    evaluatedUrl: 'https://first-run.example',
    industry: 'general_b2c',
    region: 'global',
    sitemapSource: 'fetched',
    checks: Object.fromEntries(KEYS.map(key => [key,
      key === BLOCKED ? { collection: 'blocked', assessment: 'fail' }
        : FAILING.includes(key) ? { collection: 'complete', assessment: 'fail' }
          : { collection: 'complete', assessment: 'pass' }])),
    observations: [{
      collection: 'complete', check: 'page', httpStatus: 200,
      target: describeEvidenceUrl('https://first-run.example/'), observedAt: '2026-09-20T00:00:00.000Z',
    }],
    collectedAt: '2026-09-20T00:00:00.000Z',
  })
}

async function accountOf(userId: string): Promise<string | null> {
  const rows = await sql`select account_id from profiles where id = ${userId}::uuid`
  return (rows[0]?.account_id as string | undefined) ?? null
}

async function teardown() {
  const accounts = (await Promise.all([USER, STRANGER].map(accountOf))).filter(Boolean) as string[]
  await sql`delete from scan_claim_attempts where scan_id = ${SCAN}::uuid`
  await sql`delete from scans where id = ${SCAN}::uuid`
  for (const account of accounts) {
    await sql`delete from prompt_bank where client_id in (select id from clients where account_id = ${account}::uuid)`
    await sql`delete from scans where account_id = ${account}::uuid`
    await sql`delete from clients where account_id = ${account}::uuid`
  }
  for (const user of [USER, STRANGER]) {
    await sql`delete from profiles where id = ${user}::uuid`
    await sql`delete from neon_auth.user where id = ${user}`
  }
  for (const account of accounts) await sql`delete from accounts where id = ${account}::uuid`
}

/** The real sign-up path: Neon Auth writes the user, the webhook provisions. */
async function signUp(userId: string, email: string): Promise<string> {
  await sql`
    insert into neon_auth.user (id, email, name, "emailVerified")
    values (${userId}, ${email}, 'Fixture', true)
  `
  await provisionAccountForUser(sql, { userId, email, name: 'Fixture' })
  const account = await accountOf(userId)
  if (!account) throw new Error('provisioning produced no account')
  return account
}

async function commercialAccount(accountId: string): Promise<CommercialAccount> {
  const rows = await sql`select * from accounts where id = ${accountId}::uuid`
  return rows[0] as CommercialAccount
}

async function signedInAs(userId: string, accountId: string) {
  getProfileMock.mockResolvedValue({
    id: userId, account_id: accountId, is_admin: false, accounts: await commercialAccount(accountId),
  })
}

function onboard(scanId: string, intent: string) {
  return new NextRequest('http://localhost/api/onboarding/complete', {
    method: 'POST',
    body: JSON.stringify({ brandName: 'First Run Co', domain: 'first-run.example', industry: 'general_b2c', scanId }),
    headers: { 'Content-Type': 'application/json', cookie: `${CLAIM_INTENT_COOKIE}=${intent}` },
  })
}

function intentFor(scanId: string) {
  return signScanClaimIntent({
    scanId, lang: 'en', returnPath: `/en/result/${scanId}?claim=1`, attemptId: randomUUID(),
  })
}

beforeEach(async () => {
  process.env.REPORT_SHARE_SECRET ??= 'first-run-journey-integration-secret-0123456789'
  getProfileMock.mockReset()
  await teardown()
  // The anonymous scan the visitor ran before signing up.
  await sql`
    insert into scans (id, url, domain, score, results, account_id)
    values (${SCAN}::uuid, 'https://first-run.example', 'first-run.example', 41,
      ${JSON.stringify({ evidence: evidence() })}::jsonb, null)
  `
})

/**
 * This suite deletes rows, so it refuses to run anywhere but the disposable
 * branch approved for this run — the same discipline the five older
 * exact-target suites carry. `assertApprovedTarget` turns an unconfigured run
 * into one loud failure instead of a silent skip; the in-band check then asks
 * the connected database whether it really is that branch.
 */
beforeAll(async () => {
  const target = approvedTenancyTarget()
  assertApprovedTarget(target, TENANCY_TARGET_VARIABLES)
  await assertDisposableTenancyTarget(sql, target!)
})

describe('AC-01: the first-run journey on real rows', () => {
  it('takes a fresh sign-up from an anonymous scan to a Home with at most three priorities', async () => {
    const accountId = await signUp(USER, USER_EMAIL)

    // Before onboarding: entitled to nothing, so the product cannot scan for them yet.
    expect(resolveCommercialEntitlement(await commercialAccount(accountId)).plan).toBe('free')

    await signedInAs(USER, accountId)
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const res = await POST(onboard(SCAN, intentFor(SCAN)))
    expect(res.status).toBe(200)
    const { clientId } = await res.json() as { clientId: string }

    // The scan is claimed AND attached to the brand onboarding created.
    const [scan] = await sql`select account_id, client_id from scans where id = ${SCAN}::uuid`
    expect(scan).toEqual({ account_id: accountId, client_id: clientId })

    // The trial started, and with it the entitlement to scan.
    expect(resolveCommercialEntitlement(await commercialAccount(accountId)).source).toBe('trial')

    // The question bank was seeded, minus the category outside the vocabulary.
    const prompts = await sql`select category from prompt_bank where client_id = ${clientId}::uuid order by category`
    expect(prompts.map(p => p.category)).toEqual(['brand_query', 'category_query', 'intent_query', 'pain_point'])

    // Home, loaded through the real owner-scoped loader, ranks THIS scan's evidence.
    const { loadOwnedWorkspace } = await import('@/lib/workspace/load-owned-workspace')
    const { buildWorkspaceHome } = await import('@/lib/view-models/workspace-home')
    const workspace = await loadOwnedWorkspace({
      clientId, profile: { account_id: accountId, accounts: await commercialAccount(accountId) },
    })
    expect(workspace).not.toBeNull()
    const home = buildWorkspaceHome(workspace!)
    expect(home.siteHealth.data?.scanId).toBe(SCAN)
    expect(home.priorities.state).toBe('ready')
    const listed = home.priorities.priorities.map(p => p.checkKey)
    expect(listed).toHaveLength(MAX_PRIORITIES)
    for (const key of listed) expect(FAILING).toContain(key)
    expect(listed).not.toContain(BLOCKED)
    expect(home.priorities.needsEvidence.map(c => c.checkKey)).toContain(BLOCKED)
    expect(home.priorities.primaryAction).toEqual(home.priorities.priorities[0])

    // Activation reads the two milestones the journey wrote, and nothing more.
    const { readActivation } = await import('@/lib/telemetry/activation')
    const activation = await readActivation(accountId)
    expect(activation.reached.first_scan).not.toBeNull()
    expect(activation.reached.first_workspace).not.toBeNull()
    expect(activation.reached.first_source).toBeNull()
    expect(activation.furthest).toBe('first_workspace')
  })

  it('refuses a replayed cookie without creating a second brand', async () => {
    const accountId = await signUp(USER, USER_EMAIL)
    await signedInAs(USER, accountId)
    const { POST } = await import('@/app/api/onboarding/complete/route')
    const intent = intentFor(SCAN)
    expect((await POST(onboard(SCAN, intent))).status).toBe(200)

    expect((await POST(onboard(SCAN, intent))).status).toBe(403)
    expect(await sql`select id from clients where account_id = ${accountId}::uuid`).toHaveLength(1)
  })

  it('never lets a second account take a scan the first already claimed', async () => {
    const ownerAccount = await signUp(USER, USER_EMAIL)
    await signedInAs(USER, ownerAccount)
    const { POST } = await import('@/app/api/onboarding/complete/route')
    expect((await POST(onboard(SCAN, intentFor(SCAN)))).status).toBe(200)

    const strangerAccount = await signUp(STRANGER, STRANGER_EMAIL)
    await signedInAs(STRANGER, strangerAccount)
    // Even holding a validly signed, unspent intent for the same scan id.
    expect((await POST(onboard(SCAN, intentFor(SCAN)))).status).toBe(409)
    const [scan] = await sql`select account_id from scans where id = ${SCAN}::uuid`
    expect(scan.account_id).toBe(ownerAccount)
    expect(await sql`select id from clients where account_id = ${strangerAccount}::uuid`).toHaveLength(0)
  })

  it('reads an owner who has done nothing as zero milestones, not as a failure', async () => {
    const accountId = await signUp(USER, USER_EMAIL)
    const { readActivation } = await import('@/lib/telemetry/activation')
    const activation = await readActivation(accountId)
    expect(Object.values(activation.reached).every(v => v === null)).toBe(true)
    expect(activation.furthest).toBeNull()
  })
})
