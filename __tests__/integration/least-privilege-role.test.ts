import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Proves migration 037's role really is least-privilege, against a real branch.
 *
 * The negative assertions carry the weight: asserting only that aeo_app can
 * read would pass against the owner too. Each denial is matched on its specific
 * message, because a bare "it threw" would also pass if the password were
 * simply wrong.
 */
const owner: NeonQueryFunction<false, false> = neon<false, false>(process.env.TEST_DATABASE_URL!)

/** Generated per run, never logged, never committed. */
const PASSWORD = `t${Math.random().toString(36).slice(2)}${Date.now()}`

let app: NeonQueryFunction<false, false>

beforeAll(async () => {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL is not set — globalSetup did not provision a branch')
  }

  // DDL cannot take bind parameters, and Neon's tagged template parameterises
  // every interpolation, so this must go through .query() with literal SQL.
  await owner.query(`alter role aeo_app login password '${PASSWORD}'`)

  const url = new URL(process.env.TEST_DATABASE_URL)
  url.username = 'aeo_app'
  url.password = PASSWORD
  app = neon<false, false>(url.toString())

  // Seed an account, a client and a client_reports row so the RLS visibility
  // assertion below cannot pass vacuously: an empty table returns zero rows
  // whether or not BYPASSRLS is set.
  //
  // accounts has no `name` column, and its plan check constraint (added by
  // 014_subscription_tiers.sql) only allows 'basic' | 'pro' | 'enterprise' —
  // 'free' violates it. client_reports.client_id is NOT NULL and carries a
  // composite tenant FK to clients(id, account_id)
  // (client_reports_client_tenant_fkey in 027_client_report_snapshots.sql),
  // so a real client row belonging to the same account is required — a bare
  // `null` fails that NOT NULL constraint, not the thing this suite is
  // actually testing.
  const [account] = await owner`
    insert into accounts (id, plan) values (gen_random_uuid(), 'basic')
    returning id
  `
  const [client] = await owner`
    insert into clients (id, account_id, brand_name)
    values (gen_random_uuid(), ${account.id}, 'RLS probe client')
    returning id
  `
  await owner`
    insert into client_reports (id, account_id, client_id, status)
    values (gen_random_uuid(), ${account.id}, ${client.id}, 'draft')
  `
})

describe('aeo_app can do its job', () => {
  it('connects at all', async () => {
    const rows = await app`select 1 as ok`
    expect(rows[0].ok).toBe(1)
  })

  it('reads and writes an application table', async () => {
    // accounts has no `name` column and `plan` is constrained to
    // 'basic' | 'pro' | 'enterprise' — see the beforeAll comment above.
    const inserted = await app`
      insert into accounts (id, plan) values (gen_random_uuid(), 'basic')
      returning id
    `
    expect(inserted).toHaveLength(1)

    await app`update accounts set plan = 'pro' where id = ${inserted[0].id}`
    const read = await app`select plan from accounts where id = ${inserted[0].id}`
    expect(read[0].plan).toBe('pro')

    await app`delete from accounts where id = ${inserted[0].id}`
  })

  it('sees rows in an RLS-enabled, zero-policy table', async () => {
    // THE assertion this whole design turns on. Without BYPASSRLS this returns
    // 0 while erroring nowhere. The seeded row above is what makes it mean
    // something.
    const rows = await app`select count(*)::int as n from client_reports`
    expect(rows[0].n).toBeGreaterThan(0)
  })

  it('reads neon_auth."user", the webhook\'s only authentication', async () => {
    await expect(app`select id, email from neon_auth."user" limit 1`).resolves.toBeDefined()
  })
})

describe('aeo_app cannot escalate — the assertions that matter', () => {
  it('cannot create a table', async () => {
    await expect(app`create table lp_probe_should_not_exist (id int)`)
      .rejects.toThrow(/permission denied for schema public/i)
  })

  it('cannot drop a table', async () => {
    await expect(app`drop table accounts`).rejects.toThrow(/must be owner of table/i)
  })

  it('cannot alter a table', async () => {
    await expect(app`alter table accounts add column lp_probe int`)
      .rejects.toThrow(/must be owner of table/i)
  })

  it('cannot create a role', async () => {
    await expect(app`create role lp_probe_evil`).rejects.toThrow(/permission denied to create role/i)
  })

  it('cannot write Neon Auth data despite reading it', async () => {
    await expect(
      app`insert into neon_auth."user" (id) values ('00000000-0000-0000-0000-000000000000')`,
    ).rejects.toThrow(/permission denied for table/i)
  })
})

describe('default privileges cover tables created later', () => {
  it('grants a table created after 037 without another grant statement', async () => {
    // The single most likely way this design silently rots: migration 038 adds
    // a table and the app cannot read it, surfacing at runtime in whichever
    // route touches it first.
    await owner.query('create table lp_future_table (id int primary key)')
    try {
      await expect(app`select count(*) from lp_future_table`).resolves.toBeDefined()
    } finally {
      await owner.query('drop table lp_future_table')
    }
  })
})

describe('aeo_app can execute the RPCs the application calls', () => {
  // The negative assertions elsewhere in this file are only half the contract.
  // 024 and 027 revoked EXECUTE from PUBLIC and granted it back only to
  // `service_role`, which does not exist under Neon, so after 037's cutover the
  // application connected as a role that could not run its own RPCs. Migration
  // 038 fixes that; this asserts it stays fixed. Adding an RPC without granting
  // it fails here.
  const CALLED_RPCS = [
    'public.acquire_stripe_subscription_lease(text, uuid)',
    'public.release_stripe_subscription_lease(text, uuid)',
    'public.apply_stripe_account_event(uuid, text, text, text, text, bigint, text, text, uuid)',
    'public.create_client_report_with_version(uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid)',
    'public.append_client_report_version(uuid, uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid)',
    'public.publish_client_report_latest(uuid, uuid, uuid, uuid)',
    'public.revoke_client_report(uuid, uuid, uuid)',
    'public.rotate_client_report_link(uuid, uuid, uuid)',
    'public.increment_client_report_view(text, integer)',
    'public.increment_client_report_cta_click(text, integer)',
  ]

  it.each(CALLED_RPCS)('grants EXECUTE on %s', async (signature) => {
    // Asked of the app connection itself, so this proves the privilege the
    // running application actually has -- not what the owner believes it granted.
    const rows = await app.query(
      "select has_function_privilege($1::text, 'EXECUTE') as can_execute",
      [signature],
    )
    expect(rows[0]?.can_execute).toBe(true)
  })

  it('does not grant EXECUTE on the trigger function, which needs none', async () => {
    // PostgreSQL checks EXECUTE on a trigger function at CREATE TRIGGER time,
    // not per fire, so check_brand_limit works unprivileged. Asserting the
    // absence keeps 038 from being widened without a reason.
    const rows = await app.query(
      "select has_function_privilege($1::text, 'EXECUTE') as can_execute",
      ['public.check_brand_limit()'],
    )
    expect(rows[0]?.can_execute).toBe(false)
  })
})
