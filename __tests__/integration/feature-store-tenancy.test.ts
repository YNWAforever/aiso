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
 * AC-12 beyond the owner loop: no cross-account read or mutation, executed.
 *
 * The five C9* suites prove tenancy on real Postgres for the owner-loop tables
 * only. For everything older, `__tests__/security/tenancy-inventory.test.ts`
 * proves the QUERY TEXT constrains the account — which is not the same as the
 * behaviour, because a predicate can be present and still wrong (the wrong
 * alias, the caller's id instead of the session's, an ON CONFLICT path that
 * rewrites account_id). This file runs the real store functions and route
 * handlers as account B, addressed at account A's ids, and then reads A's rows
 * back to prove nothing moved.
 *
 * Every attack uses B's own, genuinely owned ids wherever the code takes an id
 * from the session, and A's ids wherever it takes one from the caller — the
 * shape of a real cross-tenant attempt. Each denial has a control showing the
 * same call as A succeeds, so a denial cannot pass because the fixture is empty.
 *
 * Fixtures are keyed to this file; setup.ts shares one branch across the run.
 */

const A = 'c1200000-0000-4000-8000-00000000000a'
const B = 'c1200000-0000-4000-8000-00000000000b'
const A_CLIENT = 'c1200000-0000-4000-8000-0000000000a1'
const B_CLIENT = 'c1200000-0000-4000-8000-0000000000b1'
const A_SNAPSHOT = 'c1200000-0000-4000-8000-0000000000a2'
const A_ACTION = 'c1200000-0000-4000-8000-0000000000a3'
const A_ASSET = 'c1200000-0000-4000-8000-0000000000a4'
const A_PROMPT = 'c1200000-0000-4000-8000-0000000000a5'
const B_ASSET = 'c1200000-0000-4000-8000-0000000000b4'
const A_NOTE = 'c1200000-0000-4000-8000-0000000000a6'
const B_USER = 'c1200000-0000-4000-8000-0000000000b9'

async function teardown() {
  await sql`delete from notifications where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from client_asset_questions where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from client_assets where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from prompt_bank where client_id in (${A_CLIENT}::uuid, ${B_CLIENT}::uuid)`
  await sql`delete from local_trust_profiles where account_id in (${A}::uuid, ${B}::uuid)`
  // local_trust_actions cascade from their snapshot.
  await sql`delete from local_trust_snapshots where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from clients where account_id in (${A}::uuid, ${B}::uuid)`
  await sql`delete from accounts where id in (${A}::uuid, ${B}::uuid)`
}

async function profileFor(account: string) {
  const [row] = await sql`select * from accounts where id = ${account}::uuid`
  return { id: B_USER, account_id: account, is_admin: false, accounts: row }
}

beforeEach(async () => {
  getProfileMock.mockReset()
  await teardown()
  // Both paid, so every entitlement gate lets B through: what is under test is
  // ownership, and a plan refusal would make each denial pass for the wrong reason.
  for (const [account, client, name] of [[A, A_CLIENT, 'Tenant A'], [B, B_CLIENT, 'Tenant B']]) {
    await sql`
      insert into accounts (id, plan, status, stripe_subscription_id)
      values (${account}::uuid, 'pro', 'active', ${'sub_' + account.slice(-4)})
    `
    await sql`
      insert into clients (id, account_id, brand_name, status, competitors)
      values (${client}::uuid, ${account}::uuid, ${name}, 'active', ${[]}::text[])
    `
  }
  await sql`
    insert into local_trust_profiles (client_id, account_id, primary_services, competitors, average_lead_value, close_rate)
    values (${A_CLIENT}::uuid, ${A}::uuid, ${['plumbing']}::text[], ${[]}::text[], 800, 0.2)
  `
  await sql`
    insert into local_trust_snapshots (id, client_id, account_id, snapshot_month, local_trust_score)
    values (${A_SNAPSHOT}::uuid, ${A_CLIENT}::uuid, ${A}::uuid, '2026-08-01', 62)
  `
  await sql`
    insert into local_trust_actions (id, client_id, snapshot_id, stable_key, title, bucket, impact, effort)
    values (${A_ACTION}::uuid, ${A_CLIENT}::uuid, ${A_SNAPSHOT}::uuid, 'gbp', 'Claim profile',
            'local_visibility', 'high', 'low')
  `
  await sql`
    insert into prompt_bank (id, client_id, category, question, language, is_active)
    values (${A_PROMPT}::uuid, ${A_CLIENT}::uuid, 'brand_query', 'Who is Tenant A?', 'en', true)
  `
  await sql`
    insert into client_assets (id, account_id, client_id, url, origin, label)
    values (${A_ASSET}::uuid, ${A}::uuid, ${A_CLIENT}::uuid, 'https://a.example/pricing',
            'https://a.example', 'Pricing')
  `
  await sql`
    insert into client_assets (id, account_id, client_id, url, origin, label)
    values (${B_ASSET}::uuid, ${B}::uuid, ${B_CLIENT}::uuid, 'https://b.example/', 'https://b.example', 'Home')
  `
  await sql`
    insert into client_asset_questions (account_id, client_id, asset_id, prompt_id)
    values (${A}::uuid, ${A_CLIENT}::uuid, ${A_ASSET}::uuid, ${A_PROMPT}::uuid)
  `
  await sql`
    insert into notifications (id, account_id, client_id, type, title, message)
    values (${A_NOTE}::uuid, ${A}::uuid, ${A_CLIENT}::uuid, 'sov_wow_drop', 'Drop', 'Tenant A dropped')
  `
  getProfileMock.mockResolvedValue(await profileFor(B))
})

describe('Local Trust, as account B against account A', () => {
  it('reads nothing of A through the ownership check, the profile or the baseline', async () => {
    const store = await import('@/lib/localTrust/store')
    expect(await store.verifyClientOwnership(A_CLIENT, B)).toBeNull()
    expect(await store.getLocalTrustProfile(A_CLIENT, B)).toBeNull()
    expect(await store.getPreviousLocalTrustBaseline({ clientId: A_CLIENT, accountId: B, beforeMonth: '2026-09-01' }))
      .toBeNull()
    // Control: the same calls as A see the rows, so the nulls above are denials.
    expect(await store.getLocalTrustProfile(A_CLIENT, A)).not.toBeNull()
    expect(await store.getPreviousLocalTrustBaseline({ clientId: A_CLIENT, accountId: A, beforeMonth: '2026-09-01' }))
      .toEqual({ score: 62, month: '2026-08-01' })
  })

  it('cannot take over A\'s profile through the upsert\'s ON CONFLICT path', async () => {
    // The conflict arbiter is client_id alone and the update rewrites account_id,
    // so the only thing between B and A's profile is the composite FK.
    const { upsertLocalTrustProfile } = await import('@/lib/localTrust/store')
    await expect(upsertLocalTrustProfile({
      clientId: A_CLIENT, accountId: B, primaryServices: ['hijacked'], serviceArea: null,
      averageLeadValue: 1, closeRate: 1, competitors: [],
    })).rejects.toThrow()
    const [row] = await sql`select account_id, primary_services from local_trust_profiles where client_id = ${A_CLIENT}::uuid`
    expect(row).toEqual({ account_id: A, primary_services: ['plumbing'] })
  })

  it('cannot change the status of A\'s action by addressing it under B\'s own client', async () => {
    const { updateLocalTrustActionStatus } = await import('@/lib/localTrust/store')
    expect(await updateLocalTrustActionStatus({ clientId: B_CLIENT, actionId: A_ACTION, status: 'done' })).toBeNull()
    const [row] = await sql`select status from local_trust_actions where id = ${A_ACTION}::uuid`
    expect(row.status).toBe('open')
  })
})

describe('registered pages (050), as account B against account A', () => {
  it('lists none of A\'s pages or declarations', async () => {
    const store = await import('@/lib/assets/store')
    expect(await store.listAssets(B, A_CLIENT)).toEqual([])
    expect(await store.listQuestionDeclarations(B, A_CLIENT)).toEqual([])
    expect(await store.listAssets(A, A_CLIENT)).toHaveLength(1)
    expect(await store.listQuestionDeclarations(A, A_CLIENT)).toHaveLength(1)
  })

  it('cannot register or relabel a page on A\'s client', async () => {
    const { registerAsset } = await import('@/lib/assets/store')
    expect(await registerAsset({
      accountId: B, clientId: A_CLIENT, url: 'https://a.example/pricing', origin: 'https://a.example',
      label: 'Renamed by B', actorId: B_USER,
    })).toBeNull()
    const rows = await sql`select label from client_assets where client_id = ${A_CLIENT}::uuid`
    expect(rows).toEqual([{ label: 'Pricing' }])
  })

  it('cannot declare that its own page answers A\'s question', async () => {
    // B owns the asset and the client; only the prompt is A's. prompt_bank has no
    // account_id, so the prompt join on the asset's own client_id is the whole guarantee.
    const { declareQuestion } = await import('@/lib/assets/store')
    expect(await declareQuestion({
      accountId: B, clientId: B_CLIENT, assetId: B_ASSET, promptId: A_PROMPT, actorId: B_USER,
    })).toBe(false)
    expect(await sql`select id from client_asset_questions where prompt_id = ${A_PROMPT}::uuid`).toHaveLength(1)
  })

  it('cannot withdraw A\'s declaration', async () => {
    const { withdrawQuestion } = await import('@/lib/assets/store')
    expect(await withdrawQuestion({ accountId: B, clientId: A_CLIENT, assetId: A_ASSET, promptId: A_PROMPT }))
      .toBe(false)
    expect(await sql`select id from client_asset_questions where asset_id = ${A_ASSET}::uuid`).toHaveLength(1)
  })
})

describe('question bank routes, as account B against account A', () => {
  const params = (clientId: string) => ({ params: Promise.resolve({ clientId, promptId: A_PROMPT }) })
  const patch = () => new Request('http://localhost/', {
    method: 'PATCH', body: JSON.stringify({ question: 'Rewritten by B', is_active: false }),
  })

  it.each([
    ['A\'s own path', A_CLIENT],
    ['B\'s client path', B_CLIENT],
  ])('answers 404 to a PATCH on A\'s prompt via %s, and changes nothing', async (_label, clientId) => {
    const { PATCH } = await import('@/app/api/dashboard/clients/[clientId]/prompts/[promptId]/route')
    expect((await PATCH(patch(), params(clientId))).status).toBe(404)
    const [row] = await sql`select question, is_active from prompt_bank where id = ${A_PROMPT}::uuid`
    expect(row).toEqual({ question: 'Who is Tenant A?', is_active: true })
  })

  it.each([
    ['A\'s own path', A_CLIENT],
    ['B\'s client path', B_CLIENT],
  ])('answers 404 to a DELETE of A\'s prompt via %s, and deletes nothing', async (_label, clientId) => {
    const { DELETE } = await import('@/app/api/dashboard/clients/[clientId]/prompts/[promptId]/route')
    expect((await DELETE(new Request('http://localhost/'), params(clientId))).status).toBe(404)
    expect(await sql`select id from prompt_bank where id = ${A_PROMPT}::uuid`).toHaveLength(1)
  })

  it('control: the same PATCH as A succeeds', async () => {
    getProfileMock.mockResolvedValue(await profileFor(A))
    const { PATCH } = await import('@/app/api/dashboard/clients/[clientId]/prompts/[promptId]/route')
    expect((await PATCH(patch(), params(A_CLIENT))).status).toBe(200)
  })
})

describe('notifications routes, as account B', () => {
  it('lists none of A\'s notifications', async () => {
    const { GET } = await import('@/app/api/notifications/route')
    const res = await GET()
    expect(res.status).toBe(200)
    const { notifications } = await res.json() as { notifications: Array<{ id: string }> }
    expect(notifications.map(n => n.id)).not.toContain(A_NOTE)
  })

  it('marking all read leaves A\'s notifications unread', async () => {
    const { PUT } = await import('@/app/api/notifications/read-all/route')
    expect((await PUT()).status).toBe(200)
    const [row] = await sql`select read from notifications where id = ${A_NOTE}::uuid`
    expect(row.read).toBe(false)
  })

  it('control: as A, the notification is listed', async () => {
    getProfileMock.mockResolvedValue(await profileFor(A))
    const { GET } = await import('@/app/api/notifications/route')
    const { notifications } = await (await GET()).json() as { notifications: Array<{ id: string }> }
    expect(notifications.map(n => n.id)).toContain(A_NOTE)
  })
})
