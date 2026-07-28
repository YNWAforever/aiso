import { describe, it, expect, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.TEST_DATABASE_URL!)

const ACCT = '44444444-4444-4444-4444-444444444444'

async function seed(plan: string, opts: { sub?: string | null } = {}) {
  await sql`delete from scans where account_id = ${ACCT}`
  await sql`delete from clients where account_id = ${ACCT}`
  await sql`delete from accounts where id = ${ACCT}`
  await sql`
    insert into accounts (id, plan, status, stripe_subscription_id)
    values (${ACCT}, ${plan}, 'active', ${opts.sub ?? null})
  `
}

async function grantTrial() {
  return sql`
    update accounts
    set trial_started_at = coalesce(trial_started_at, now()),
        trial_ends_at    = coalesce(trial_ends_at, now() + interval '7 days'),
        plan = case when trial_started_at is null
                     and coalesce(stripe_subscription_id, '') = ''
                    then 'basic' else plan end
    where id = ${ACCT}
    returning trial_ends_at
  `
}

describe('activation against real Postgres', () => {
  beforeEach(async () => { await seed('basic') })

  it('grants a 7-day trial on first call', async () => {
    const rows = await grantTrial()
    expect(rows[0].trial_ends_at).toBeTruthy()
    const acct = await sql`select trial_started_at from accounts where id = ${ACCT}`
    expect(acct[0].trial_started_at).toBeTruthy()
  })

  it('does not restart an existing trial', async () => {
    const first = await grantTrial()
    const second = await grantTrial()
    expect(new Date(second[0].trial_ends_at as string).getTime())
      .toBe(new Date(first[0].trial_ends_at as string).getTime())
  })

  it('pins an enterprise account to basic when granting', async () => {
    await seed('enterprise')
    await grantTrial()
    const acct = await sql`select plan from accounts where id = ${ACCT}`
    expect(acct[0].plan).toBe('basic')
  })

  it('leaves the plan alone when a subscription exists', async () => {
    await seed('pro', { sub: 'sub_live' })
    await grantTrial()
    const acct = await sql`select plan from accounts where id = ${ACCT}`
    expect(acct[0].plan).toBe('pro')
  })

  it('repairs a missing expiry without moving the start date', async () => {
    await sql`
      update accounts set trial_started_at = now() - interval '2 days', trial_ends_at = null
      where id = ${ACCT}
    `
    await grantTrial()
    const acct = await sql`select trial_started_at, trial_ends_at from accounts where id = ${ACCT}`
    expect(acct[0].trial_ends_at).toBeTruthy()
    expect(new Date(acct[0].trial_started_at as string).getTime())
      .toBeLessThan(Date.now() - 60_000)
  })

  it('grants no trial when the brand insert is rejected', async () => {
    // basic caps at 1 brand; create one, then attempt a second in the same
    // statement shape the service uses. The trigger aborts the whole statement.
    await sql`
      insert into clients (brand_name, account_id, status, competitors)
      values ('First', ${ACCT}, 'active', ${[]}::text[])
    `
    await sql`update accounts set trial_started_at = null, trial_ends_at = null where id = ${ACCT}`

    await expect(sql`
      with inserted as (
        insert into clients (brand_name, account_id, status, competitors)
        values ('Second', ${ACCT}, 'active', ${[]}::text[])
        returning id
      ),
      trial as (
        update accounts
        set trial_started_at = coalesce(trial_started_at, now()),
            trial_ends_at    = coalesce(trial_ends_at, now() + interval '7 days')
        where id = ${ACCT}
        returning trial_ends_at
      )
      select inserted.id, trial.trial_ends_at from inserted, trial
    `).rejects.toThrow(/BRAND_LIMIT_REACHED/)

    const acct = await sql`select trial_started_at from accounts where id = ${ACCT}`
    expect(acct[0].trial_started_at).toBeNull()
  })
})
