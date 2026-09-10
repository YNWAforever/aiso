import { describe, it, expect, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { buildSourceContent, hashSourceContent } from '@/lib/sources/schema'

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
