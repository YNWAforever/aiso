import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { buildSourceContent, hashSourceContent } from '@/lib/sources/schema'
import { importSource, listSources, listAgentUsableSources, revokeSource, setAgentUse } from '@/lib/sources/store'
import { buildSourcePack } from '@/lib/view-models/source-pack'

vi.mock('server-only', () => ({}))
// The store reads through db(); point it at the same provisioned branch the raw
// assertions below use, so the SQL gate and the projection see one database.
// The factory imports dynamically because vi.mock is hoisted above this file's
// own imports, so the top-level `neon` binding is not yet initialised when it runs.
vi.mock('@/lib/db', async () => {
  const { neon: connect } = await import('@neondatabase/serverless')
  return { db: () => connect(process.env.TEST_DATABASE_URL!) }
})

/**
 * Migration 044's guarantees, against real Postgres.
 *
 * This lives in the DEFAULT integration config rather than a sixth exact-target
 * one, so `npm test` and the CI gate actually run it. The five configs outside
 * the gate are the reason 109 tests could report success while asserting
 * nothing; adding to that set would repeat the mistake.
 */

const sql = neon(process.env.TEST_DATABASE_URL!)

const ACCOUNT = '44444444-4444-4444-4444-444444444444'
const OTHER = '55555555-5555-5555-5555-555555555555'

const content = (answer: string) => buildSourceContent([{ question: 'What are your hours?', answer }])

async function seed() {
  await sql`delete from client_source_versions where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from client_sources where account_id in (${ACCOUNT}, ${OTHER})`
  // scans and profiles reference accounts as well, and this branch is shared
  // with the other integration suites, so those rows have to go before the
  // accounts can. neon_auth.user is cleared last because profiles FK into it.
  await sql`delete from scans where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from clients where account_id in (${ACCOUNT}, ${OTHER})`
  const actors = await sql`select id from profiles where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from profiles where account_id in (${ACCOUNT}, ${OTHER})`
  for (const row of actors as { id: string }[]) {
    await sql`delete from neon_auth.user where id = ${row.id}`
  }
  await sql`delete from accounts where id in (${ACCOUNT}, ${OTHER})`
  for (const id of [ACCOUNT, OTHER]) {
    await sql`insert into accounts (id, plan, status) values (${id}, 'pro', 'active')`
  }
}

async function brand(account: string, name: string): Promise<string> {
  const rows = await sql`
    insert into clients (brand_name, account_id, status, competitors)
    values (${name}, ${account}, 'active', ${[]}::text[]) returning id
  `
  return rows[0]!.id as string
}

/** profiles.id FKs neon_auth.user (migration 022), so the user row comes first. */
async function profile(account: string): Promise<string> {
  const id = crypto.randomUUID()
  await sql`insert into neon_auth.user (id,email,name,"emailVerified") values (${id},${`${id}@example.test`},'Source fixture',false)`
  await sql`insert into profiles (id,account_id,display_name) values (${id},${account},'Source fixture')`
  return id
}

async function source(account: string, clientId: string, key = 'brand-facts'): Promise<string> {
  const rows = await sql`
    insert into client_sources (account_id, client_id, source_key, kind, label)
    values (${account}, ${clientId}, ${key}, 'facts', 'Brand facts') returning id
  `
  return rows[0]!.id as string
}

async function version(account: string, clientId: string, sourceId: string, n: number, answer = '9 to 6') {
  const body = content(answer)
  await sql`
    insert into client_source_versions (
      account_id, client_id, source_id, version_number, content, content_hash, import_method
    ) values (
      ${account}, ${clientId}, ${sourceId}, ${n},
      ${JSON.stringify(body)}::jsonb, ${hashSourceContent(body)}, 'paste'
    )
  `
}

describe('approved sources: tenancy is structural', () => {
  beforeEach(seed)

  it('refuses a source pointing at another account client', async () => {
    const foreign = await brand(OTHER, 'Other brand')

    // The composite FK references clients (id, account_id), so this pair simply
    // does not exist. Application filtering is not what stops it.
    await expect(sql`
      insert into client_sources (account_id, client_id, source_key, kind, label)
      values (${ACCOUNT}, ${foreign}, 'stolen', 'facts', 'Stolen')
    `).rejects.toThrow(/client_sources_owned_client_fk|foreign key/i)
  })

  it('refuses a version whose account does not match its source', async () => {
    const owned = await brand(ACCOUNT, 'Owned')
    const id = await source(ACCOUNT, owned)

    await expect(version(OTHER, owned, id, 1)).rejects.toThrow(/foreign key|violates/i)
  })

  it('keeps two accounts using the same source_key separate', async () => {
    const mine = await brand(ACCOUNT, 'Mine')
    const theirs = await brand(OTHER, 'Theirs')
    await source(ACCOUNT, mine, 'brand-facts')
    await source(OTHER, theirs, 'brand-facts')

    const rows = await sql`select id from client_sources where account_id = ${ACCOUNT}`
    expect(rows).toHaveLength(1)
  })
})

describe('approved sources: content is append-only and validated', () => {
  beforeEach(seed)

  it('rejects a second version with the same number rather than overwriting', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const id = await source(ACCOUNT, clientId)
    await version(ACCOUNT, clientId, id, 1)

    await expect(version(ACCOUNT, clientId, id, 1, 'different')).rejects.toThrow(/unique|duplicate/i)
  })

  it('keeps version 1 readable exactly as written after version 2 lands', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const id = await source(ACCOUNT, clientId)
    await version(ACCOUNT, clientId, id, 1, 'original')
    await version(ACCOUNT, clientId, id, 2, 'edited')

    const rows = await sql`
      select version_number, content from client_source_versions
      where account_id = ${ACCOUNT} and source_id = ${id} order by version_number
    `
    expect(rows).toHaveLength(2)
    expect((rows[0]!.content as { entries: { answer: string }[] }).entries[0]!.answer).toBe('original')
  })

  it.each([
    ['{"schemaVersion":2,"entries":[{"question":"q","answer":"a"}]}', 'a wrong schema version'],
    ['{"schemaVersion":1,"entries":[]}', 'an empty pack'],
    ['{"schemaVersion":1,"entries":[{"question":"q"}]}', 'an entry with no answer'],
    ['{"schemaVersion":1,"entries":[{"question":"","answer":"a"}]}', 'an empty question'],
    ['{"schemaVersion":1,"entries":["not an object"]}', 'a non-object entry'],
  ])('refuses %s at the database, not only in the service', async (json) => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const id = await source(ACCOUNT, clientId)

    await expect(sql`
      insert into client_source_versions (
        account_id, client_id, source_id, version_number, content, content_hash, import_method
      ) values (
        ${ACCOUNT}, ${clientId}, ${id}, 1, ${json}::jsonb, ${'a'.repeat(64)}, 'paste'
      )
    `).rejects.toThrow(/content_check|violates/i)
  })

  it('requires approver and approval time to be recorded together', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const id = await source(ACCOUNT, clientId)
    const body = content('9 to 6')

    await expect(sql`
      insert into client_source_versions (
        account_id, client_id, source_id, version_number, content, content_hash,
        import_method, approved_at
      ) values (
        ${ACCOUNT}, ${clientId}, ${id}, 1, ${JSON.stringify(body)}::jsonb,
        ${hashSourceContent(body)}, 'paste', now()
      )
    `).rejects.toThrow(/approval_check|violates/i)
  })
})

describe('approved sources: revocation is a state', () => {
  beforeEach(seed)

  it('requires the revocation time and actor together', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const id = await source(ACCOUNT, clientId)

    await expect(sql`
      update client_sources set revoked_at = now()
      where account_id = ${ACCOUNT} and id = ${id}
    `).rejects.toThrow(/revocation_check|violates/i)
  })

  it('retains the content of a revoked source, so a draft that cited it stays explainable', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const id = await source(ACCOUNT, clientId)
    await version(ACCOUNT, clientId, id, 1, 'cited by a draft')
    const actor = await profile(ACCOUNT)
    // A real revocation, with both halves recorded, since that is what the
    // paired-null constraint requires and what the service actually writes.
    await sql`
      update client_sources set revoked_at = now(), revoked_by = ${actor}, agent_use_allowed = false
      where account_id = ${ACCOUNT} and id = ${id}
    `

    const rows = await sql`
      select content from client_source_versions where account_id = ${ACCOUNT} and source_id = ${id}
    `
    expect(rows).toHaveLength(1)
    expect((rows[0]!.content as { entries: { answer: string }[] }).entries[0]!.answer).toBe('cited by a draft')
  })

  it('denies agent use by default, so an import is inert until someone says otherwise', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const id = await source(ACCOUNT, clientId)

    const rows = await sql`select agent_use_allowed from client_sources where id = ${id}`
    expect(rows[0]!.agent_use_allowed).toBe(false)
  })
})

/**
 * The screen and the gate, checked against each other on real Postgres.
 *
 * `listAgentUsableSources` is SQL and `buildSourcePack` is TypeScript, so the
 * two say "a draft may quote this" in different languages and can drift apart
 * silently. The drift surfaces as an owner-visible lie — a source shown as ready
 * that nothing will ever cite, or one quietly quoted after being switched off —
 * so the agreement is asserted rather than assumed.
 */
describe('approved sources: the projection agrees with the gate', () => {
  beforeEach(seed)

  async function scenario() {
    const clientId = await brand(ACCOUNT, 'Brand')
    const actor = await profile(ACCOUNT)
    const scope = { accountId: ACCOUNT, clientId, actorId: actor }
    const entries = [{ question: 'What are your hours?', answer: '9 to 6' }]
    const importOne = (sourceKey: string, approve: boolean) =>
      importSource(scope, { sourceKey, kind: 'facts' as const, label: sourceKey, entries, importMethod: 'paste' as const, originRef: null, approve })

    // One source in each state the gate distinguishes.
    const usable = await importOne('usable', true)
    const unapproved = await importOne('unapproved', true)
    const offSwitch = await importOne('off-switch', true)
    const revoked = await importOne('revoked', true)
    for (const result of [usable, unapproved, offSwitch, revoked]) expect(result.kind).toBe('created')

    const idOf = (result: Awaited<ReturnType<typeof importOne>>) =>
      (result as { source: { id: string } }).source.id

    await setAgentUse(scope, idOf(usable), true)
    await setAgentUse(scope, idOf(unapproved), true)
    await setAgentUse(scope, idOf(revoked), true)
    // Approval is stamped at import; strip it from one to isolate that predicate.
    await sql`update client_source_versions set approved_at = null, approved_by = null
      where account_id = ${ACCOUNT} and source_id = ${idOf(unapproved)}`
    await revokeSource(scope, idOf(revoked))
    // off-switch keeps agent_use_allowed = false, which is 044's default.

    return { scope, ids: { usable: idOf(usable), unapproved: idOf(unapproved), offSwitch: idOf(offSwitch), revoked: idOf(revoked) } }
  }

  it('shows exactly the sources the SQL gate returns as in use', async () => {
    const { scope } = await scenario()

    const gated = (await listAgentUsableSources(scope)).map(source => source.id).sort()
    const shown = buildSourcePack(await listSources(scope)).entries
      .filter(entry => entry.usability === 'in-use').map(entry => entry.id).sort()

    expect(gated).toHaveLength(1)
    expect(shown).toEqual(gated)
  })

  it('names the right blocker for each source the gate excluded', async () => {
    const { scope, ids } = await scenario()

    const pack = buildSourcePack(await listSources(scope))
    const usabilityOf = (id: string) => pack.entries.find(entry => entry.id === id)?.usability

    expect(usabilityOf(ids.usable)).toBe('in-use')
    expect(usabilityOf(ids.unapproved)).toBe('awaiting-approval')
    expect(usabilityOf(ids.offSwitch)).toBe('not-permitted')
    expect(usabilityOf(ids.revoked)).toBe('revoked')
    expect(pack).toMatchObject({ inUse: 1, awaitingApproval: 1, revoked: 1 })
  })

  it('keeps a revoked source listed for the owner while the gate refuses it', async () => {
    // Two different questions: "may a draft cite this" and "did this ever
    // exist". Dropping it from the screen would make a past citation
    // unexplainable.
    const { scope, ids } = await scenario()

    expect((await listAgentUsableSources(scope)).map(source => source.id)).not.toContain(ids.revoked)
    expect(buildSourcePack(await listSources(scope)).entries.map(entry => entry.id)).toContain(ids.revoked)
  })

  it('reflects a switched-off source on the very next read', async () => {
    const { scope, ids } = await scenario()
    await setAgentUse(scope, ids.usable, false)

    expect(await listAgentUsableSources(scope)).toHaveLength(0)
    expect(buildSourcePack(await listSources(scope)).inUse).toBe(0)
  })

  it('sees nothing at all from another account', async () => {
    const { ids } = await scenario()
    const foreign = await brand(OTHER, 'Other brand')
    const intruder = { accountId: OTHER, clientId: foreign, actorId: await profile(OTHER) }

    expect(await listSources(intruder)).toEqual([])
    expect(await listAgentUsableSources(intruder)).toEqual([])
    expect(ids.usable).toBeTruthy()
  })
})

/**
 * A decision outlives its actor; provenance does not. 046 makes that the schema's
 * stated intent rather than something two disagreeing clauses produced by accident.
 *
 * 044 declared `revoked_by` and `approved_by` as profile FKs with `on delete set
 * null`, while a CHECK on each table required the actor and its timestamp to be
 * null together — so the referential action performed exactly the write the CHECK
 * forbade, and deleting the profile failed on a constraint that mentions no
 * profile. 046 drops those two FKs and leaves both CHECKs untouched: the decision
 * is still indivisible on write, and the recorded uuid is now a frozen identity,
 * which is the rule 042 and 043 already state in their own headers.
 *
 * `created_by` and `imported_by` deliberately keep their FK and their `set null`.
 * They carry no paired CHECK, so SET NULL is a real behaviour there — losing "who
 * first pasted this" when a colleague leaves is acceptable in a way that losing
 * "who approved it" is not. This test pins both halves of that asymmetry, because
 * an over-broad fix that dropped all four FKs would still make the first assertion
 * pass.
 */
describe('approved sources: a decision outlives its actor, provenance does not', () => {
  beforeEach(seed)

  it('keeps who revoked and who approved when their profile is deleted, and forgets who imported', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const actor = await profile(ACCOUNT)
    const scope = { accountId: ACCOUNT, clientId, actorId: actor }
    const imported = await importSource(scope, {
      sourceKey: 'revoked-later', kind: 'facts', label: 'Revoked later',
      entries: [{ question: 'Hours?', answer: '9 to 6' }],
      importMethod: 'paste', originRef: null, approve: true,
    })
    expect(imported.kind).toBe('created')
    await revokeSource(scope, (imported as { source: { id: string } }).source.id)

    // Before 046 this raised 23514 naming client_sources_revocation_check.
    await sql`delete from profiles where id = ${actor}`
    await sql`delete from neon_auth.user where id = ${actor}`

    const [source] = await sql`
      select revoked_by, revoked_at, created_by from client_sources where account_id = ${ACCOUNT}
    ` as { revoked_by: string | null; revoked_at: string | null; created_by: string | null }[]
    const [version] = await sql`
      select approved_by, approved_at, imported_by from client_source_versions where account_id = ${ACCOUNT}
    ` as { approved_by: string | null; approved_at: string | null; imported_by: string | null }[]

    // The decisions survive, both halves of each still paired.
    expect(source!.revoked_by).toBe(actor)
    expect(source!.revoked_at).not.toBeNull()
    // The versions half is the one the old test never reached, and the one that
    // matters more: client_source_versions is append-only, so an approval is the
    // most durable record in the feature.
    expect(version!.approved_by).toBe(actor)
    expect(version!.approved_at).not.toBeNull()

    // Provenance is erasable, and still is. An over-broad fix that dropped all
    // four profile FKs would pass every assertion above and fail these two.
    expect(source!.created_by).toBeNull()
    expect(version!.imported_by).toBeNull()
  })

  it('still refuses a revocation with only one half recorded', async () => {
    // 046 relaxes neither CHECK. Dropping the FK must not make a decision
    // divisible on write — that property is the reason the contradiction was
    // worth resolving in this direction rather than the other.
    const clientId = await brand(ACCOUNT, 'Brand')
    const id = await source(ACCOUNT, clientId)

    await expect(sql`
      update client_sources set revoked_at = now() where account_id = ${ACCOUNT} and id = ${id}
    `).rejects.toThrow(/client_sources_revocation_check/)
  })
})

/**
 * This file shares one Neon branch, and one ACCOUNT id, with
 * `stripe-webhook-lifecycle.test.ts`, whose seed deletes that account. A revoked
 * source left behind here makes THAT file fail, on a constraint that names
 * neither suite — so this one clears its own rows rather than relying on the
 * next file's seed to survive them.
 */
afterAll(async () => {
  await sql`delete from client_source_versions where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from client_sources where account_id in (${ACCOUNT}, ${OTHER})`
})
