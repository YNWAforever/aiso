import { randomUUID } from 'node:crypto'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertApprovedTarget } from './approved-target'

// AUTHORED ONLY for C9c Task 3. Do not run without separate authorization for
// the exact disposable branch after migration 041 has been applied there.
const approvedBranch = process.env.C9C_WORK_ITEMS_DISPOSABLE_BRANCH_ID
const approvedProject = process.env.C9C_WORK_ITEMS_PROJECT_ID
const approvedOwner = process.env.C9C_WORK_ITEMS_OWNER_ROLE
const protectedBranches = new Set(['br-square-mountain-az6f82vi', process.env.NEON_TEST_PRODUCTION_BRANCH_ID].filter(Boolean))

it('refuses to report success without an approved disposable target', () => assertApprovedTarget(approvedBranch, 'C9C_WORK_ITEMS_DISPOSABLE_BRANCH_ID, C9C_WORK_ITEMS_PROJECT_ID and C9C_WORK_ITEMS_OWNER_ROLE'))

describe.skipIf(!approvedBranch)('evidence work items on exact disposable target', () => {
  let sql: NeonQueryFunction<false, false>
  let verified = false
  const account = randomUUID(), otherAccount = randomUUID(), client = randomUUID(), actor = randomUUID(), source = randomUUID()
  const key = `pulse-brand-absent.v1:pulse-metric:${source}:`
  const snapshot = JSON.stringify({schemaVersion:1,source:{kind:'pulse-metric',id:source}})
  const hash = 'a'.repeat(64)

  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL || !approvedProject || !approvedOwner || !approvedBranch || protectedBranches.has(approvedBranch) || !/^br-[a-z0-9-]+$/.test(approvedBranch)) {
      throw new Error('Exact disposable work-item target required')
    }
    sql = neon(process.env.TEST_DATABASE_URL)
    const [identity] = await sql`select current_setting('neon.project_id',true) project, current_setting('neon.branch_id',true) branch, current_user role, (select pg_get_userbyid(relowner) = current_user from pg_class where oid = 'public.evidence_work_items'::regclass) owner_capable`
    if (identity.project !== approvedProject || identity.branch !== approvedBranch || identity.role !== approvedOwner || !identity.owner_capable) throw new Error('Disposable work-item target mismatch')
    verified = true
    await sql`insert into accounts (id,plan) values (${account},'basic'),(${otherAccount},'basic')`
    await sql`insert into clients (id,account_id,brand_name) values (${client},${account},'Draft fixture')`
    await sql`insert into neon_auth.user (id,email,name,"emailVerified") values (${actor},${`${actor}@example.test`},'Draft actor',false)`
    await sql`insert into profiles (id,account_id,display_name) values (${actor},${account},'Draft actor')`
    await sql`insert into pulse_metrics (id,client_id,platform,question,raw_answer,brand_mentioned,scan_week) values (${source},${client},'test','Question','Answer',false,'2026-09-01')`
  })

  afterAll(async () => {
    if (!verified) return
    await sql`delete from pulse_metrics where id = ${source}`
    await sql`delete from evidence_work_items where account_id = ${account}`
    await sql`delete from neon_auth.user where id = ${actor}`
    await sql`delete from accounts where id in (${account},${otherAccount})`
  })

  const insert = (accountId = account, actorId: string | null = null) => sql`
    insert into evidence_work_items (account_id,client_id,opportunity_key,source_kind,source_id,rule_version,evidence_fingerprint,evidence_snapshot,title,action,notes,locale,created_by,updated_by)
    values (${accountId},${client},${key},'pulse-metric',${source},'pulse-brand-absent.v1',${hash},${snapshot}::jsonb,'Review','Check evidence','','en',${actorId},${actorId})
    on conflict (account_id,client_id,opportunity_key) do nothing returning id
  `

  it('rejects a wrong-account client relationship', async () => {
    await expect(insert(otherAccount)).rejects.toMatchObject({code:'23503'})
  })

  it('retains the snapshot when the actor and source row are deleted', async () => {
    expect(await insert(account,actor)).toHaveLength(1)
    await sql`delete from profiles where id = ${actor}`
    await sql`delete from pulse_metrics where id = ${source}`
    const [row] = await sql`select created_by,updated_by,evidence_snapshot from evidence_work_items where account_id=${account} and client_id=${client} and opportunity_key=${key}`
    expect(row.created_by).toBeNull()
    expect(row.updated_by).toBeNull()
    expect(row.evidence_snapshot).toEqual(JSON.parse(snapshot))
  })

  it('enforces one row for concurrent inserts', async () => {
    await sql`delete from evidence_work_items where account_id=${account} and client_id=${client}`
    const results = await Promise.all([insert(),insert()])
    expect(results.flat()).toHaveLength(1)
  })

  it('grants app reads and writes but no deletion', async () => {
    const [grants] = await sql`select has_table_privilege('aeo_app','public.evidence_work_items','SELECT') can_read, has_table_privilege('aeo_app','public.evidence_work_items','INSERT') can_insert, has_table_privilege('aeo_app','public.evidence_work_items','UPDATE') can_update, has_table_privilege('aeo_app','public.evidence_work_items','DELETE') can_delete, has_table_privilege('aeo_app','public.evidence_work_items','TRUNCATE') can_truncate`
    expect(grants).toEqual({can_read:true,can_insert:true,can_update:true,can_delete:false,can_truncate:false})
  })
})
