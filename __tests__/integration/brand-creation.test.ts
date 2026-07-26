import { describe, it, expect, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.TEST_DATABASE_URL!)

const ACCOUNT = '11111111-1111-1111-1111-111111111111'

// check_brand_limit() (supabase/migrations/028_account_plan_overrides.sql) only
// grants the stored plan's brand limit when the account is genuinely active —
// status = 'active' AND a non-empty stripe_subscription_id. An account with
// plan = 'pro' but no subscription id resolves to the *free* effective plan
// (limit 1), same as resolveCommercialEntitlement() in lib/tier.ts. So a paid
// plan must be seeded with a subscription id or the trigger (correctly) treats
// it as unpaid.
async function seedAccount(plan: string): Promise<void> {
  await sql`delete from clients where account_id = ${ACCOUNT}`
  await sql`delete from accounts where id = ${ACCOUNT}`
  const stripeSubscriptionId = plan === 'free' ? null : `sub_test_${plan}`
  await sql`
    insert into accounts (id, plan, status, stripe_subscription_id)
    values (${ACCOUNT}, ${plan}, 'active', ${stripeSubscriptionId})
  `
}

async function createBrand(name: string): Promise<{ id: string }[]> {
  return sql`
    insert into clients (brand_name, domain, industry, competitors, account_id, status)
    values (${name}, null, null, ${[]}::text[], ${ACCOUNT}, 'active')
    returning id
  ` as unknown as Promise<{ id: string }[]>
}

describe('brand creation against real Postgres', () => {
  beforeEach(async () => {
    await seedAccount('pro')
  })

  it('inserts a brand scoped to the account', async () => {
    const rows = await createBrand('Acme')
    expect(rows[0].id).toBeTruthy()

    const found = await sql`select brand_name, account_id from clients where id = ${rows[0].id}`
    expect(found[0].brand_name).toBe('Acme')
    expect(found[0].account_id).toBe(ACCOUNT)
  })

  it('lets the check_brand_limit trigger reject the fourth brand on pro', async () => {
    await createBrand('One')
    await createBrand('Two')
    await createBrand('Three')
    await expect(createBrand('Four')).rejects.toThrow(/BRAND_LIMIT_REACHED/)
  })

  it('lets a basic account create only one brand', async () => {
    await seedAccount('basic')
    await createBrand('Only')
    await expect(createBrand('Second')).rejects.toThrow(/BRAND_LIMIT_REACHED/)
  })
})
