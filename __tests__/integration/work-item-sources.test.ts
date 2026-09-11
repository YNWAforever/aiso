import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'

/**
 * Migration 051's guarantees, against real Postgres.
 *
 * __tests__/db/work-item-sources-migration.test.ts asserts the migration's SQL
 * TEXT — it fails the moment a clause is deleted, but it cannot prove a partial
 * unique index actually behaves partially, or that a CHECK actually rejects a
 * bad row. This file is the only place that behaviour is established.
 *
 * Lives in the DEFAULT integration config, not a sixth exact-target one, so
 * `npm test` and the CI gate actually run it — see client-sources.test.ts's own
 * comment on why that distinction matters, and the five configs this repo
 * already keeps outside the gate.
 */

const sql = neon(process.env.TEST_DATABASE_URL!)

const ACCOUNT = '99999999-9999-9999-9999-999999999999'
const OTHER = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

const FINGERPRINT = 'a'.repeat(64)
const EVIDENCE_SNAPSHOT = JSON.stringify({ schemaVersion: 1, note: 'fixture' })

async function seed() {
  await sql`delete from work_item_sources where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from evidence_work_items where account_id in (${ACCOUNT}, ${OTHER})`
  // scans references accounts as well, and this branch is shared with the other
  // integration suites, so those rows have to go before clients/accounts can.
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
  await sql`insert into neon_auth.user (id,email,name,"emailVerified") values (${id},${`${id}@example.test`},'Work item fixture',false)`
  await sql`insert into profiles (id,account_id,display_name) values (${id},${account},'Work item fixture')`
  return id
}

/**
 * A parent work item, seeded directly — there is no lib/ store for
 * evidence_work_items in this repo, only the SQL 041/051 enforce. Its own
 * opportunity_key (unique per account+client on this table) is independent of
 * the opportunity_key a source attaches with below: 051's own header says the
 * claim belongs to the source, not to the item.
 */
async function workItem(account: string, clientId: string, opportunityKey: string): Promise<string> {
  const rows = await sql`
    insert into evidence_work_items (
      account_id, client_id, opportunity_key, source_kind, source_id, rule_version,
      evidence_fingerprint, evidence_snapshot, title, action, notes, locale
    ) values (
      ${account}, ${clientId}, ${opportunityKey}, 'pulse-metric', ${crypto.randomUUID()},
      'pulse-brand-absent.v1', ${FINGERPRINT}, ${EVIDENCE_SNAPSHOT}::jsonb,
      'Fix the thing', 'Do the thing', '', 'en'
    ) returning id
  `
  return rows[0]!.id as string
}

type SourceKind = 'pulse-metric' | 'scan-check' | 'agent-recommendation'

/**
 * Attaches a source to a work item. Defaults describe a fully VALID
 * pulse-metric attachment, so each case below overrides only the field its
 * scenario means to violate — a case testing one constraint should not
 * incidentally trip a different one by accident of a shared default.
 */
async function attachSource(params: {
  account: string
  clientId: string
  workItemId: string
  opportunityKey: string
  sourceKind?: SourceKind
  sourceId?: string
  ruleVersion?: string
  checkKey?: string | null
  attachedBy?: string | null
}): Promise<string> {
  const {
    account, clientId, workItemId, opportunityKey,
    sourceKind = 'pulse-metric',
    sourceId = crypto.randomUUID(),
    ruleVersion = 'pulse-brand-absent.v1',
    checkKey = null,
    attachedBy = null,
  } = params
  const rows = await sql`
    insert into work_item_sources (
      account_id, client_id, work_item_id, opportunity_key, source_kind, source_id,
      rule_version, check_key, evidence_fingerprint, evidence_snapshot, attached_by
    ) values (
      ${account}, ${clientId}, ${workItemId}, ${opportunityKey}, ${sourceKind}, ${sourceId},
      ${ruleVersion}, ${checkKey}, ${FINGERPRINT}, ${EVIDENCE_SNAPSHOT}::jsonb, ${attachedBy}
    ) returning id
  `
  return rows[0]!.id as string
}

/**
 * Reproduces the CTE shape createDraftIfEvidenceCurrent uses in
 * lib/work-items/store.ts:
 *   with mutation as ( insert into evidence_work_items ... on conflict do
 *   nothing returning ... ), source_ins as ( insert into work_item_sources
 *   (...) select ... from mutation returning id ) select * from mutation
 *
 * The store's own `mutation` CTE inserts via a SELECT joined against
 * clients/pulse_metrics to reverify the caller's evidence snapshot hasn't
 * drifted -- that join, and the EvidenceVersionToken it depends on, is a
 * business check unrelated to the CTE-atomicity claim under test here, so
 * it is replaced with a plain VALUES tuple carrying the same columns
 * workItem() above already seeds with. Every clause the atomicity claim
 * actually depends on is reproduced verbatim: the on-conflict target on
 * (account_id, client_id, opportunity_key), source_ins selecting its
 * work_item_id FROM mutation's own RETURNING rows (never a literal or a
 * scalar subquery), and the trailing select naming only `mutation`. The
 * explicit ::uuid/::jsonb casts on source_ins's SELECT list are copied
 * verbatim from the store too -- a SELECT-based insert does not get the
 * same implicit column-type coercion a plain VALUES tuple gets, which is
 * exactly why the store casts there and nowhere else.
 */
async function runCreateDraftCte(params: {
  account: string
  clientId: string
  opportunityKey: string
  sourceId: string
}) {
  const { account, clientId, opportunityKey, sourceId } = params
  const rows = await sql`
    with mutation as (
      insert into evidence_work_items (
        account_id, client_id, opportunity_key, source_kind, source_id, rule_version,
        evidence_fingerprint, evidence_snapshot, title, action, notes, locale
      ) values (
        ${account}, ${clientId}, ${opportunityKey}, 'pulse-metric', ${sourceId},
        'pulse-brand-absent.v1', ${FINGERPRINT}, ${EVIDENCE_SNAPSHOT}::jsonb,
        'Fix the thing', 'Do the thing', '', 'en'
      )
      on conflict (account_id, client_id, opportunity_key) do nothing
      returning id, client_id, opportunity_key
    ), source_ins as (
      insert into work_item_sources (
        account_id, client_id, work_item_id, opportunity_key, source_kind, source_id,
        rule_version, check_key, evidence_fingerprint, evidence_snapshot, attached_by
      )
      select ${account}::uuid, ${clientId}::uuid, mutation.id, ${opportunityKey}, 'pulse-metric', ${sourceId}::uuid,
        'pulse-brand-absent.v1', null, ${FINGERPRINT}, ${EVIDENCE_SNAPSHOT}::jsonb, null
      from mutation
      returning id
    )
    select * from mutation
  ` as { id: string; client_id: string; opportunity_key: string }[]
  return rows
}

describe('work_item_sources: an opportunity is claimed by at most one live source', () => {
  beforeEach(seed)

  it('refuses a second item claiming a key still held by a live source', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const itemA = await workItem(ACCOUNT, clientId, 'item-a')
    const itemB = await workItem(ACCOUNT, clientId, 'item-b')

    await attachSource({ account: ACCOUNT, clientId, workItemId: itemA, opportunityKey: 'shared-claim' })

    // Same account, same client, same opportunity_key, but a DIFFERENT item —
    // the index does not care which item holds the claim, only that at most
    // one live row does.
    await expect(
      attachSource({ account: ACCOUNT, clientId, workItemId: itemB, opportunityKey: 'shared-claim' }),
    ).rejects.toThrow(/work_item_sources_live_opportunity_idx/)
  })
})

describe('work_item_sources: withdrawal frees the claim and keeps the row', () => {
  beforeEach(seed)

  it('lets a second item claim the key once the first source is withdrawn, without deleting it', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const actor = await profile(ACCOUNT)
    const itemA = await workItem(ACCOUNT, clientId, 'item-a')
    const itemB = await workItem(ACCOUNT, clientId, 'item-b')

    const firstId = await attachSource({ account: ACCOUNT, clientId, workItemId: itemA, opportunityKey: 'freed-claim' })
    await sql`
      update work_item_sources set withdrawn_at = now(), withdrawn_by = ${actor}
      where id = ${firstId}
    `

    const secondId = await attachSource({ account: ACCOUNT, clientId, workItemId: itemB, opportunityKey: 'freed-claim' })

    const rows = await sql`
      select id, withdrawn_at from work_item_sources where id in (${firstId}, ${secondId})
    ` as { id: string; withdrawn_at: string | null }[]
    expect(rows).toHaveLength(2)
    expect(rows.find(r => r.id === firstId)!.withdrawn_at).not.toBeNull()
    expect(rows.find(r => r.id === secondId)!.withdrawn_at).toBeNull()
  })
})

describe('work_item_sources: a withdrawn source can be re-attached to the same item', () => {
  beforeEach(seed)

  it('allows the same source_kind/source_id pair back on the item that withdrew it', async () => {
    // What being PARTIAL (not a plain table-level unique) buys: if
    // work_item_sources_live_item_source_idx counted withdrawn rows, this same
    // source could never return to THIS item again, while it could still be
    // attached to any OTHER item — the opposite of why withdrawal exists
    // instead of deletion.
    const clientId = await brand(ACCOUNT, 'Brand')
    const actor = await profile(ACCOUNT)
    const itemA = await workItem(ACCOUNT, clientId, 'item-a')
    const sharedSourceId = crypto.randomUUID()

    const firstId = await attachSource({
      account: ACCOUNT, clientId, workItemId: itemA, opportunityKey: 'reattach-first',
      sourceKind: 'agent-recommendation', ruleVersion: 'stored-recommendation.v1', sourceId: sharedSourceId,
    })
    await sql`
      update work_item_sources set withdrawn_at = now(), withdrawn_by = ${actor}
      where id = ${firstId}
    `

    // A different opportunity_key than the withdrawn row used, freshly unclaimed,
    // so a pass here can only be explained by the item/source index — the
    // opportunity index (case above) is not in play for this key.
    const secondId = await attachSource({
      account: ACCOUNT, clientId, workItemId: itemA, opportunityKey: 'reattach-second',
      sourceKind: 'agent-recommendation', ruleVersion: 'stored-recommendation.v1', sourceId: sharedSourceId,
    })

    const rows = await sql`
      select id, withdrawn_at from work_item_sources
      where account_id = ${ACCOUNT} and client_id = ${clientId}
        and work_item_id = ${itemA} and source_id = ${sharedSourceId}
      order by attached_at
    ` as { id: string; withdrawn_at: string | null }[]
    expect(rows.map(r => r.id)).toEqual([firstId, secondId])
    expect(rows[0]!.withdrawn_at).not.toBeNull()
    expect(rows[1]!.withdrawn_at).toBeNull()
  })
})

describe('work_item_sources: a scan-check source must name the check it came from', () => {
  beforeEach(seed)

  it('rejects a scan-check source with a null check_key', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const itemA = await workItem(ACCOUNT, clientId, 'item-a')

    // Verified against real Postgres, not assumed: this row is rejected, but
    // the constraint Postgres actually names is work_item_sources_rule_source_check,
    // never work_item_sources_source_check_key_check. That is not this input
    // being unlucky -- it is structural. rule_source_check's three branches
    // each already pin check_key's nullness to source_kind one-for-one
    // (null for pulse-metric/agent-recommendation, not-null for scan-check),
    // which is exactly the rule source_check_key_check states on its own. So
    // EVERY row that violates source_check_key_check -- in both directions,
    // scan-check-with-null and non-scan-check-with-non-null -- also violates
    // rule_source_check, and Postgres evaluates check constraints by name
    // ('r' before 's'), so rule_source_check is the one that fires and is
    // reported. source_check_key_check still holds real, correct meaning, but
    // given the current constraint set it can never be the constraint an error
    // names -- worth knowing, not a defect: the row is still unconditionally
    // rejected either way.
    await expect(
      attachSource({
        account: ACCOUNT, clientId, workItemId: itemA, opportunityKey: 'no-check-key',
        sourceKind: 'scan-check', ruleVersion: 'scan-check-gap.v1', checkKey: null,
      }),
    ).rejects.toThrow(/work_item_sources_rule_source_check/)
  })
})

describe('work_item_sources: rule_version must match its source_kind', () => {
  beforeEach(seed)

  it('rejects a pulse-metric source carrying the scan-check rule version', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const itemA = await workItem(ACCOUNT, clientId, 'item-a')

    // check_key stays null, which is what source_kind='pulse-metric' requires —
    // so this row fails only the rule/source pairing, not the check-key rule.
    await expect(
      attachSource({
        account: ACCOUNT, clientId, workItemId: itemA, opportunityKey: 'wrong-rule-version',
        sourceKind: 'pulse-metric', ruleVersion: 'scan-check-gap.v1', checkKey: null,
      }),
    ).rejects.toThrow(/work_item_sources_rule_source_check/)
  })
})

describe('work_item_sources: withdrawal is one fact recorded two ways', () => {
  beforeEach(seed)

  it('rejects withdrawn_at set without withdrawn_by', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const itemA = await workItem(ACCOUNT, clientId, 'item-a')
    const id = await attachSource({ account: ACCOUNT, clientId, workItemId: itemA, opportunityKey: 'half-withdrawn' })

    await expect(
      sql`update work_item_sources set withdrawn_at = now() where id = ${id}`,
    ).rejects.toThrow(/work_item_sources_withdrawal_check/)
  })
})

describe("work_item_sources: a source cannot name another account's item", () => {
  beforeEach(seed)

  it('rejects a work_item_id that belongs to a different account', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const foreignClientId = await brand(OTHER, 'Other brand')
    const foreignItem = await workItem(OTHER, foreignClientId, 'foreign-item')

    // The composite FK references evidence_work_items (account_id, client_id,
    // id), so the triple (ACCOUNT, clientId, foreignItem) simply matches no
    // row there — application filtering is not what stops this.
    await expect(
      attachSource({ account: ACCOUNT, clientId, workItemId: foreignItem, opportunityKey: 'cross-account' }),
    ).rejects.toThrow(/work_item_sources_owned_item_fk/)
  })
})

describe('work_item_sources: the app role has no DELETE', () => {
  beforeEach(seed)

  it('grants app reads and writes but no deletion', async () => {
    // has_table_privilege against the catalogue, not a runtime DELETE denial.
    // A runtime denial was tried first, twice:
    //   1. Rotating aeo_app's password (the least-privilege-role.test.ts
    //      technique) and reconnecting as it -- works, but mutates shared
    //      role state that every other suite on this branch also depends on.
    //   2. sql.transaction([sql`set local role aeo_app`, ...]) -- the
    //      pattern change-set-approvals.test.ts uses at ~line 111 to prove a
    //      different runtime denial. It fails HERE with the Postgres error
    //      'permission denied to set role "aeo_app"': that file runs against
    //      its own exact disposable target (C9D_TEST_DATABASE_URL) where a
    //      human installs aeo_app and grants the migrating role membership
    //      in it by hand. This suite runs against the default integration
    //      harness's TEST_DATABASE_URL, whose migrating role is not a member
    //      of aeo_app, so SET ROLE is refused before the DELETE is ever
    //      attempted. Do not reintroduce set local role here without first
    //      granting that membership on this harness's target.
    // The catalogue read below is the fallback every other sibling in this
    // directory takes for the same reason: evidence-work-items.test.ts
    // (~line 73), delivery-attestations.test.ts (~line 151), and
    // client-entities.test.ts (~line 50). It also checks SELECT/INSERT/UPDATE
    // are still granted (what 051 actually grants) and TRUNCATE stays
    // refused, not just DELETE, so this fails on a grant accidentally
    // widened as readily as one narrowed.
    //
    // has_table_privilege reads table-level metadata, not any particular
    // row, so there is nothing to attach and nothing that could "survive" --
    // the previous version of this case created a row and re-selected it
    // afterward to confirm the failed DELETE left it in place; that
    // assertion is dropped along with the DELETE attempt it was validating.
    const [grants] = await sql`
      select
        has_table_privilege('aeo_app', 'public.work_item_sources', 'SELECT') can_read,
        has_table_privilege('aeo_app', 'public.work_item_sources', 'INSERT') can_insert,
        has_table_privilege('aeo_app', 'public.work_item_sources', 'UPDATE') can_update,
        has_table_privilege('aeo_app', 'public.work_item_sources', 'DELETE') can_delete,
        has_table_privilege('aeo_app', 'public.work_item_sources', 'TRUNCATE') can_truncate
    `
    expect(grants).toEqual({ can_read: true, can_insert: true, can_update: true, can_delete: false, can_truncate: false })
  })
})

describe("work_item_sources: createDraftIfEvidenceCurrent's item+source insert is one atomic statement", () => {
  beforeEach(seed)

  it('a fresh insert writes the item and its first source together, and the outer select returns the item', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const sourceId = crypto.randomUUID()

    // What a mocked unit test cannot show: __tests__/work-items/store.test.ts
    // mocks `@/lib/db` and string-matches the query TEXT -- it never sends
    // this to a real planner, so it cannot execute a CTE at all. A store bug
    // that dropped `, source_ins as (...)` entirely, referenced the wrong
    // CTE name, or turned source_ins's insert into a plain select would
    // still return the same `mutation` row shape and pass every mocked test
    // unchanged. Only a real Postgres run can catch that -- which is what
    // the work_item_sources assertion below is for.
    //
    // That same assertion is also the only proof needed that Postgres runs
    // a data-modifying CTE the trailing SELECT never names: `select * from
    // mutation` mentions only `mutation`, never `source_ins`. If Postgres
    // only executed the CTEs the final query actually reads, source_ins
    // would never run and work_item_sources would stay empty here even
    // though `rows` below still comes back non-empty. A second, dedicated
    // case could not show this any more clearly than this one already does.
    const rows = await runCreateDraftCte({ account: ACCOUNT, clientId, opportunityKey: 'mutation-cte-fresh', sourceId })
    expect(rows).toHaveLength(1)
    const itemId = rows[0]!.id

    const items = await sql`
      select id from evidence_work_items
      where account_id = ${ACCOUNT} and client_id = ${clientId} and opportunity_key = 'mutation-cte-fresh'
    ` as { id: string }[]
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe(itemId)

    const sources = await sql`
      select id, source_id from work_item_sources
      where account_id = ${ACCOUNT} and client_id = ${clientId} and work_item_id = ${itemId}
    ` as { id: string; source_id: string }[]
    expect(sources).toHaveLength(1)
    expect(sources[0]!.source_id).toBe(sourceId)
  })

  it('a conflicting second run inserts neither row, resolves without throwing, and leaves exactly one source', async () => {
    const clientId = await brand(ACCOUNT, 'Brand')
    const firstSourceId = crypto.randomUUID()
    const firstRows = await runCreateDraftCte({ account: ACCOUNT, clientId, opportunityKey: 'mutation-cte-conflict', sourceId: firstSourceId })
    expect(firstRows).toHaveLength(1)
    const itemId = firstRows[0]!.id

    // What would silently pass without this: if source_ins's `from mutation`
    // did not actually see mutation's zero-row RETURNING on this conflict --
    // say, if a future edit swapped it for a scalar subquery, or the
    // on-conflict target column list drifted from evidence_work_items' real
    // unique constraint -- this second call would either throw (a NULL or
    // mismatched work_item_id failing work_item_sources' NOT NULL or FK
    // check) or silently attach a second, orphaned source row under the
    // first item. A mocked unit test cannot distinguish either wrong outcome
    // from the correct one: it never runs the on-conflict path against a
    // real unique index at all, so it would keep passing under any of them.
    const secondSourceId = crypto.randomUUID()
    await expect(
      runCreateDraftCte({ account: ACCOUNT, clientId, opportunityKey: 'mutation-cte-conflict', sourceId: secondSourceId }),
    ).resolves.toEqual([])

    const items = await sql`
      select id from evidence_work_items
      where account_id = ${ACCOUNT} and client_id = ${clientId} and opportunity_key = 'mutation-cte-conflict'
    ` as { id: string }[]
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe(itemId)

    // Exactly one -- not two (source_ins re-firing on the conflicting run)
    // and not zero (the first run's source somehow lost or overwritten).
    const sources = await sql`
      select id from work_item_sources
      where account_id = ${ACCOUNT} and client_id = ${clientId} and work_item_id = ${itemId}
    ` as { id: string }[]
    expect(sources).toHaveLength(1)
  })
})

/**
 * Fresh, otherwise-unused account ids (see the sibling suites in this
 * directory for the ones already spoken for), but cleaned up anyway: leftover
 * work_item_sources/evidence_work_items rows would block a later run's
 * `delete from clients` via the ON DELETE RESTRICT chain 051 adds.
 */
afterAll(async () => {
  await sql`delete from work_item_sources where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from evidence_work_items where account_id in (${ACCOUNT}, ${OTHER})`
  // Mirrors seed()'s delete order. Dormant today -- this file never writes
  // scans -- but a future case that does would otherwise fail the
  // `delete from accounts` below on a foreign key, with nothing here to
  // connect that failure back to this cause.
  await sql`delete from scans where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from clients where account_id in (${ACCOUNT}, ${OTHER})`
  const actors = await sql`select id from profiles where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from profiles where account_id in (${ACCOUNT}, ${OTHER})`
  for (const row of actors as { id: string }[]) {
    await sql`delete from neon_auth.user where id = ${row.id}`
  }
  await sql`delete from accounts where id in (${ACCOUNT}, ${OTHER})`
})
