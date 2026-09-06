import { randomUUID } from 'node:crypto'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
let sql: NeonQueryFunction<false, false>
vi.mock('@/lib/db', () => ({db: () => sql}))
import { loadEntity, saveEntity } from '@/lib/entities/store'

// NOT RUN for C9a. Requires separately authorized exact disposable branch and
// migration 040 already applied. Use vitest.entity-integration.config.ts only.
const approvedBranch = process.env.C9_ENTITY_DISPOSABLE_BRANCH_ID
const approvedProject = process.env.C9_ENTITY_PROJECT_ID
const approvedOwner = process.env.C9_ENTITY_OWNER_ROLE
const protectedBranches = new Set(['br-square-mountain-az6f82vi', process.env.NEON_TEST_PRODUCTION_BRANCH_ID].filter(Boolean))
describe.skipIf(!approvedBranch)('private entities on exact disposable target', () => {
  const account = randomUUID(), other = randomUUID(), client = randomUUID()
  let verified = false
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL || !approvedProject || !approvedOwner || !approvedBranch || protectedBranches.has(approvedBranch) || !/^br-[a-z0-9-]+$/.test(approvedBranch)) throw new Error('Exact disposable entity target required')
    sql = neon(process.env.TEST_DATABASE_URL)
    const [identity] = await sql`select current_setting('neon.project_id',true) project, current_setting('neon.branch_id',true) branch, current_user role, (select pg_get_userbyid(relowner) = current_user from pg_class where oid = 'public.client_entities'::regclass) owner_capable`
    if (identity.project !== approvedProject || identity.branch !== approvedBranch || identity.role !== approvedOwner || !identity.owner_capable) throw new Error('Disposable entity target mismatch')
    verified = true
    await sql`insert into accounts (id,plan) values (${account},'basic'), (${other},'basic')`
    await sql`insert into clients (id,account_id,brand_name) values (${client},${account},'Entity fixture')`
  })
  afterAll(async () => { if (verified) await sql`delete from accounts where id in (${account},${other})` })
  it('has no GET write, one concurrent create, retry no increment, stale/future conflict and guarded ownership', async () => {
    expect(await loadEntity(account,client)).toBeNull()
    const payload = {displayName:'Brand',aliases:['Alias'],expectedRevision:0}
    const results = await Promise.all([saveEntity(account,client,null,payload),saveEntity(account,client,null,payload)])
    expect(results.map(row => row?.revision)).toEqual([1,1])
    expect((await saveEntity(account,client,null,payload))?.revision).toBe(1)
    expect(await saveEntity(account,client,null,{...payload,displayName:'Different'})).toBeNull()
    expect(await saveEntity(account,client,null,{...payload,expectedRevision:2})).toBeNull()
    expect(await saveEntity(other,client,null,payload)).toBeNull()
    expect(await loadEntity(other,client)).toBeNull()
    const updates = await Promise.all(['A','B'].map(displayName => saveEntity(account,client,null,{...payload,displayName,expectedRevision:1})))
    expect(updates.filter(Boolean)).toHaveLength(1)
    expect((await loadEntity(account,client))?.revision).toBe(2)
  })
  it('rejects tenant mismatch and invalid alias data in the actual database', async () => {
    await expect(sql`update client_entities set account_id = ${other} where client_id = ${client} and account_id = ${account}`).rejects.toMatchObject({code:'23503'})
    await expect(sql`update client_entities set aliases = ${'[42]'}::jsonb where client_id = ${client} and account_id = ${account}`).rejects.toMatchObject({code:'23514'})
    await expect(sql`update client_entities set aliases = ${JSON.stringify(['x'.repeat(121)])}::jsonb where client_id = ${client} and account_id = ${account}`).rejects.toMatchObject({code:'23514'})
    const [grants] = await sql`select has_table_privilege('aeo_app','public.client_entities','SELECT') can_read, has_table_privilege('aeo_app','public.client_entities','INSERT') can_insert, has_table_privilege('aeo_app','public.client_entities','UPDATE') can_update, has_table_privilege('aeo_app','public.client_entities','DELETE') can_delete, has_table_privilege('aeo_app','public.client_entities','TRUNCATE') can_truncate`
    expect(grants).toEqual({can_read:true,can_insert:true,can_update:true,can_delete:false,can_truncate:false})
  })
})
