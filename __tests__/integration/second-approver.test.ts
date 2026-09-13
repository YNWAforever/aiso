import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { provisionAccountForUser } from '@/app/api/webhooks/neon/route'
import { freezeReview } from '@/lib/change-sets/validation'
import type { WorkItem } from '@/lib/work-items/schema'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', async () => {
  const { neon: connect } = await import('@neondatabase/serverless')
  return { db: () => connect(process.env.TEST_DATABASE_URL!) }
})

const sql = neon(process.env.TEST_DATABASE_URL!)

/**
 * The composition AC-14 actually needs, end to end, against real Postgres.
 *
 * Each half is proven elsewhere — account-invitations.test.ts proves a second
 * member can be created, and the change-set suites prove `can_decide`'s logic.
 * Neither proves the two JOIN UP, and that join is the whole point of this
 * work: before migration 047 the inputs `can_decide` requires could not be
 * produced at all, so the predicate was correct and permanently false.
 *
 * What this file does NOT cover is the browser journey. It shows that an
 * invited member reaches `canDecide: true`; it does not show anybody clicking
 * approve. That needs two humans and a magic link.
 *
 * Fixtures are keyed to this file — setup.ts provisions one branch for the
 * whole run and every file shares it.
 */

const ACCOUNT = 'a9000000-0000-4000-8000-000000000001'
const OWNER = 'a9000000-0000-4000-8000-000000000002'
const INVITEE = 'a9000000-0000-4000-8000-000000000003'
const ADMIN = 'a9000000-0000-4000-8000-000000000004'
const CLIENT = 'a9000000-0000-4000-8000-000000000005'
const WORK_ITEM = 'a9000000-0000-4000-8000-000000000006'

const OWNER_EMAIL = 'owner-a9@example.com'
const INVITEE_EMAIL = 'approver-a9@example.com'
const ADMIN_EMAIL = 'admin-a9@example.com'

const evidenceSnapshot: WorkItem['evidenceSnapshot'] = {
  schemaVersion: 1,
  source: { kind: 'pulse-metric', id: '123e4567-e89b-42d3-a456-426614174000' },
  ruleVersion: 'pulse-brand-absent.v1',
  evidence: {
    kind: 'pulse-metric', id: '123e4567-e89b-42d3-a456-426614174000', promptId: null,
    question: 'Example?', platform: 'chatgpt', scanWeek: '2026-08-31', recordedAt: null,
    result: 'success', hasAnswer: true, brandMentioned: false, answerDigest: 'a'.repeat(64),
    provenance: 'retained-pulse-metric', limitations: [],
  },
  limitations: [], titleKey: 'review-question-coverage', actionKey: 'review-question-coverage',
  args: { question: 'Example?', platform: 'chatgpt' }, locale: 'en',
  initialTitle: 'Review question coverage', initialAction: 'Review the recorded response.',
}

const review = freezeReview({
  id: WORK_ITEM, clientId: CLIENT, status: 'draft', title: 'Review question coverage',
  action: 'Review the recorded response.', notes: '', locale: 'en', revision: 1,
  createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z', evidenceSnapshot,
})

async function teardown() {
  // Order matters: work_item_versions restricts deletion of its work item, and
  // account_approver_events restricts deletion of its account.
  await sql`delete from work_item_versions where account_id = ${ACCOUNT}::uuid`
  await sql`delete from evidence_work_items where account_id = ${ACCOUNT}::uuid`
  await sql`delete from account_invitations where account_id = ${ACCOUNT}::uuid`
  await sql`delete from account_approver_state where account_id = ${ACCOUNT}::uuid`
  await sql`delete from account_approver_events where account_id = ${ACCOUNT}::uuid`
  await sql`delete from clients where account_id = ${ACCOUNT}::uuid`
  for (const person of [OWNER, INVITEE, ADMIN]) {
    const owned = (await sql`
      select account_id from profiles where id = ${person}::uuid and account_id is not null
    `) as Array<{ account_id: string }>
    await sql`delete from profiles where id = ${person}::uuid`
    // A fresh account minted by provisioning, when the invitation path was not
    // taken. Never touch an account another file's rows reference.
    for (const row of owned) {
      if (row.account_id !== ACCOUNT) {
        await sql`delete from accounts where id = ${row.account_id}::uuid`
      }
    }
    await sql`delete from neon_auth.user where id = ${person}`
  }
  await sql`delete from accounts where id = ${ACCOUNT}::uuid`
}

async function authUser(id: string, email: string) {
  await sql`
    insert into neon_auth.user (id, email, name, "emailVerified")
    values (${id}, ${email}, 'Fixture', false)
  `
}

beforeEach(async () => {
  await teardown()
  await sql`insert into accounts (id, plan, status) values (${ACCOUNT}::uuid, 'basic', 'active')`
  await sql`
    insert into clients (id, account_id, brand_name)
    values (${CLIENT}::uuid, ${ACCOUNT}::uuid, 'A9 fixture')
  `
  await authUser(OWNER, OWNER_EMAIL)
  await authUser(ADMIN, ADMIN_EMAIL)
  // The invitee deliberately has NO neon_auth.user row yet. Seeding one here
  // made createInvitation answer `already_registered` — correctly, because an
  // address that has signed in can never consume an invitation. The real
  // sequence is invite first, sign up second, so signUp() does it in order.
  await sql`
    insert into profiles (id, account_id, display_name)
    values (${OWNER}::uuid, ${ACCOUNT}::uuid, 'Owner')
  `
  await sql`
    insert into profiles (id, account_id, display_name, is_admin)
    values (${ADMIN}::uuid, ${ACCOUNT}::uuid, 'Admin', true)
  `
  await sql`
    insert into evidence_work_items
      (id, account_id, client_id, opportunity_key, source_kind, source_id, rule_version,
       evidence_fingerprint, evidence_snapshot, title, action, locale)
    values (${WORK_ITEM}::uuid, ${ACCOUNT}::uuid, ${CLIENT}::uuid, ${randomUUID()}, 'pulse-metric',
       ${evidenceSnapshot.source.id}, 'pulse-brand-absent.v1', ${'a'.repeat(64)},
       ${JSON.stringify(evidenceSnapshot)}::jsonb, 'Review', 'Review response', 'en')
  `
})

/** A version submitted by the OWNER — so the owner can never decide it. */
async function submitVersion(): Promise<string> {
  const id = randomUUID()
  await sql`
    insert into work_item_versions
      (id, account_id, client_id, work_item_id, version_number, draft_revision,
       content, content_hash, validation, submitter)
    values (${id}::uuid, ${ACCOUNT}::uuid, ${CLIENT}::uuid, ${WORK_ITEM}::uuid, 1, 1,
       ${JSON.stringify(review.content)}::jsonb, ${review.contentHash},
       ${JSON.stringify(review.validation)}::jsonb,
       ${JSON.stringify({ profileId: OWNER, displayName: 'Owner', role: 'account_member' })}::jsonb)
  `
  return id
}

/**
 * The invitee signs in for the first time: Neon Auth creates the user row,
 * then delivers `user.created`. Order matters — an invitation may only be
 * created while no auth user exists for the address.
 */
async function signUp(name: string) {
  await authUser(INVITEE, INVITEE_EMAIL)
  await provisionAccountForUser(sql, { userId: INVITEE, email: INVITEE_EMAIL, name })
}

/** Through the product's own service, as a platform administrator would. */
async function grantApprover(profileId: string) {
  const { mutateApproverAccess } = await import('@/lib/approvals/access-store')
  const result = await mutateApproverAccess(ADMIN, ACCOUNT, {
    profileId, action: 'grant', reason: 'AC-14 second approver', expectedRevision: 0,
    requestId: randomUUID(),
  })
  if (!('value' in result)) throw new Error(`grant failed: ${result.kind}`)
}

async function canDecide(versionId: string, actorId: string): Promise<boolean> {
  const { readVersion } = await import('@/lib/change-sets/store')
  const result = await readVersion(ACCOUNT, CLIENT, WORK_ITEM, versionId, actorId)
  if (!('value' in result)) throw new Error(`readVersion: ${result.kind}`)
  return result.value.capabilities.canDecide
}

describe('an invited member can reach canDecide', () => {
  it('is false for the submitter whatever role they hold', async () => {
    const versionId = await submitVersion()
    await grantApprover(OWNER)

    // AC-08 denies the submitter regardless of role. This is the branch the
    // 2026-09-11 E2E run actually exercised, when no second member could exist.
    expect(await canDecide(versionId, OWNER)).toBe(false)
  })

  it('becomes true for a member who joined by invitation and was granted the role', async () => {
    const { createInvitation } = await import('@/lib/members/store')
    expect((await createInvitation({
      accountId: ACCOUNT, invitedBy: OWNER, email: INVITEE_EMAIL,
    })).kind).toBe('created')

    await signUp('Approver')

    const versionId = await submitVersion()
    await grantApprover(INVITEE)

    expect(await canDecide(versionId, INVITEE)).toBe(true)
    // And separation of duties still holds for the submitter.
    expect(await canDecide(versionId, OWNER)).toBe(false)
  })

  it('stays false for an invited member who holds no approver grant', async () => {
    const { createInvitation } = await import('@/lib/members/store')
    await createInvitation({ accountId: ACCOUNT, invitedBy: OWNER, email: INVITEE_EMAIL })
    await signUp('Approver')

    const versionId = await submitVersion()

    // "Membership is not permission to approve" — the sentence the Members
    // panel prints, asserted against the predicate that enforces it.
    expect(await canDecide(versionId, INVITEE)).toBe(false)
  })

  /**
   * The failure this whole change exists to remove. Without an invitation the
   * second sign-in mints its own account, and `can_decide` requires the actor
   * to be in the SAME account as the version — so it is false no matter what
   * role that person is given.
   */
  it('leaves a second sign-in that was never invited unable to see the version at all', async () => {
    await signUp('Stranger')

    const versionId = await submitVersion()
    const [profile] = (await sql`
      select account_id from profiles where id = ${INVITEE}::uuid
    `) as Array<{ account_id: string }>
    expect(profile.account_id).not.toBe(ACCOUNT)

    // Stronger than `canDecide: false`, and worth stating precisely: readRows'
    // `owned` CTE requires the actor to be a member of the account, so a
    // stranger gets `not_found` rather than a readable version they may not
    // decide. This is the state every second sign-in was in before 047.
    const { readVersion } = await import('@/lib/change-sets/store')
    expect(await readVersion(ACCOUNT, CLIENT, WORK_ITEM, versionId, INVITEE))
      .toEqual({ kind: 'not_found' })
  })
})
