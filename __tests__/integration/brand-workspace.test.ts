import { describe, it, expect, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.TEST_DATABASE_URL!)

const ACCOUNT = '22222222-2222-2222-2222-222222222222'
const OTHER   = '33333333-3333-3333-3333-333333333333'

async function seed() {
  await sql`delete from scans where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from clients where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from accounts where id in (${ACCOUNT}, ${OTHER})`
  for (const id of [ACCOUNT, OTHER]) {
    await sql`insert into accounts (id, plan, status, stripe_subscription_id)
              values (${id}, 'pro', 'active', ${'sub_' + id.slice(0, 8)})`
  }
}

async function brand(account: string, name: string): Promise<string> {
  const rows = await sql`
    insert into clients (brand_name, account_id, status, competitors)
    values (${name}, ${account}, 'active', ${[]}::text[])
    returning id
  `
  return rows[0].id as string
}

async function scan(account: string, clientId: string | null, domain: string) {
  await sql`
    insert into scans (url, domain, results, account_id, client_id)
    values (${'https://' + domain}, ${domain}, ${'{}'}::jsonb, ${account}, ${clientId})
  `
}

describe('brand-scoped scans', () => {
  beforeEach(seed)

  it('returns only the scans belonging to the requested brand', async () => {
    const a = await brand(ACCOUNT, 'Brand A')
    const b = await brand(ACCOUNT, 'Brand B')
    await scan(ACCOUNT, a, 'a.example')
    await scan(ACCOUNT, b, 'b.example')

    const rows = await sql`
      select domain from scans
      where client_id = ${a} and account_id = ${ACCOUNT}
    `
    expect(rows.map(r => r.domain)).toEqual(['a.example'])
  })

  it('excludes anonymous scans that belong to no brand', async () => {
    const a = await brand(ACCOUNT, 'Brand A')
    await scan(ACCOUNT, null, 'anon.example')

    const rows = await sql`
      select domain from scans where client_id = ${a} and account_id = ${ACCOUNT}
    `
    expect(rows).toHaveLength(0)
  })

  it('refuses a scan pointing at a brand owned by another account', async () => {
    const foreign = await brand(OTHER, 'Someone Else')
    await expect(scan(ACCOUNT, foreign, 'x.example')).rejects.toThrow()
  })

  it('nulls client_id rather than deleting the scan when a brand is removed', async () => {
    const a = await brand(ACCOUNT, 'Brand A')
    await scan(ACCOUNT, a, 'a.example')
    await sql`delete from clients where id = ${a}`
    const rows = await sql`select client_id from scans where account_id = ${ACCOUNT}`
    expect(rows).toHaveLength(1)
    expect(rows[0].client_id).toBeNull()
  })
})
