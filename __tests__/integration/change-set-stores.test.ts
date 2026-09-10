import { randomUUID } from 'node:crypto'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertApprovedTarget } from './approved-target'
import { draft } from '../change-sets/fixtures'
import { submitVersion, readVersion } from '@/lib/change-sets/store'
import { mutateApproverAccess } from '@/lib/approvals/access-store'
import { decideVersion } from '@/lib/approvals/decision-store'
import type { ApproverAccessInput, ReviewDecisionInput } from '@/lib/change-sets/types'

// AUTHORED ONLY: exact disposable target approval and schema 042 are external gates.
// No global setup, env-file loader, provisioning, migration or cleanup is permitted.
// The only mocked boundary supplies the verified real application SQL function.
const connection = vi.hoisted(() => ({ sql: undefined as NeonQueryFunction<false, false> | undefined }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: () => {
  if (!connection.sql) throw new Error('C9D_STORE_TARGET_NOT_VERIFIED')
  return connection.sql
} }))
const project = process.env.C9D_DISPOSABLE_PROJECT_ID
const branch = process.env.C9D_DISPOSABLE_BRANCH_ID
const ownerUrl = process.env.C9D_TEST_DATABASE_URL
const appUrl = process.env.C9D_TEST_APP_DATABASE_URL
const optedIn = Boolean(project || branch || ownerUrl || appUrl)

it('refuses to report success without an approved disposable target', () => assertApprovedTarget(optedIn, 'C9D_DISPOSABLE_PROJECT_ID, C9D_DISPOSABLE_BRANCH_ID, C9D_TEST_DATABASE_URL and C9D_TEST_APP_DATABASE_URL'))

describe.skipIf(!optedIn)('actual C9d stores on an approved disposable target', () => {
  let owner: NeonQueryFunction<false, false>
  let app: NeonQueryFunction<false, false>
  let beforeTransaction: (() => Promise<void>) | undefined
  let account: string, otherAccount: string, client: string, author: string, reviewer: string, admin: string, item: string

  beforeAll(async () => {
    const protectedBranches = new Set(['br-square-mountain-az6f82vi', process.env.NEON_TEST_PRODUCTION_BRANCH_ID])
    if (!project || !branch || !ownerUrl || !appUrl || !/^br-[a-z0-9-]+$/.test(branch) || protectedBranches.has(branch) || /production|staging|main|default/i.test(branch)) throw new Error('Exact disposable C9d target required')
    for (const value of [ownerUrl, appUrl]) {
      const url = new URL(value)
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech')) throw new Error('Dedicated Neon test connections required')
    }
    owner = neon(ownerUrl); app = neon(appUrl)
    // Both identities and installed schema are checked before the first fixture write.
    for (const [sql, isApp] of [[owner, false], [app, true]] as const) {
      const [identity] = await sql`select current_setting('neon.project_id',true) project, current_setting('neon.branch_id',true) branch, current_user role, (select pg_get_userbyid(relowner)=current_user from pg_class where oid='public.work_item_versions'::regclass) owns_versions, to_regclass('public.account_approver_state') is not null has_state`
      if (identity.project !== project || identity.branch !== branch || !identity.has_state || (isApp ? identity.role !== 'aeo_app' : !identity.owns_versions || identity.role === 'aeo_app')) throw new Error('Disposable C9d identity/schema mismatch')
    }
    connection.sql = new Proxy(app, { get(target, key, receiver) {
      if (key !== 'transaction') return Reflect.get(target, key, receiver)
      return async (...args: Parameters<typeof app.transaction>) => {
        const hook = beforeTransaction; beforeTransaction = undefined
        if (hook) await hook()
        return app.transaction(...args)
      }
    } })
  })

  beforeEach(async () => {
    beforeTransaction = undefined
    account=randomUUID(); otherAccount=randomUUID(); client=randomUUID(); author=randomUUID(); reviewer=randomUUID(); admin=randomUUID(); item=randomUUID()
    await owner`insert into accounts (id,plan) values (${account},'basic'),(${otherAccount},'basic')`
    await owner`insert into clients (id,account_id,brand_name) values (${client},${account},'C9d store fixture')`
    for (const id of [author,reviewer,admin]) {
      await owner`insert into neon_auth.user (id,email,name,"emailVerified") values (${id},${`${id}@example.test`},'Store fixture',false)`
      await owner`insert into profiles (id,account_id,display_name,is_admin) values (${id},${account},'Store fixture',${id===admin})`
    }
    const value=draft()
    await owner`insert into evidence_work_items (id,account_id,client_id,opportunity_key,source_kind,source_id,rule_version,evidence_fingerprint,evidence_snapshot,title,action,notes,locale) values (${item},${account},${client},${randomUUID()},'pulse-metric',${value.evidenceSnapshot.source.id},'pulse-brand-absent.v1',${'a'.repeat(64)},${JSON.stringify(value.evidenceSnapshot)}::jsonb,${value.title},${value.action},${value.notes},${value.locale})`
  })
  const access = (action: 'grant'|'revoke', expectedRevision: number): ApproverAccessInput => ({profileId:reviewer,action,expectedRevision,reason:'Reviewed membership',requestId:randomUUID()})
  const decision = (): ReviewDecisionInput => ({decision:'approved',reason:'Reviewed retained evidence',requestId:randomUUID()})
  const grant = () => mutateApproverAccess(admin,account,access('grant',0))
  const submit = () => submitVersion(account,client,item,author,1)
  async function version() {
    const result=await submit(); expect(result.kind).toBe('created')
    if (!('value' in result)) throw new Error('Expected persisted version')
    return result.value
  }
  async function auditCount() {
    const [row]=await owner`select count(*)::int n from account_approver_events where account_id=${account} and profile_id=${reviewer}`
    return row.n
  }
  // Pause an actual store operation after its pre-read, before its real transaction.
  // The competing operation commits first, then the paused operation rechecks DB state.
  function pauseNextTransaction() {
    let arrived!: () => void, release!: () => void
    const entered=new Promise<void>(resolve => { arrived=resolve })
    const released=new Promise<void>(resolve => { release=resolve })
    beforeTransaction=async () => { arrived(); await released }
    return {entered,release}
  }

  it('serializes concurrent first grants with one state and one audit, then replays exact request', async () => {
    const input=access('grant',0)
    const results=await Promise.all([mutateApproverAccess(admin,account,input),mutateApproverAccess(admin,account,access('grant',0))])
    expect(results.map(r=>r.kind).sort()).toEqual(['conflict','created'])
    expect(await auditCount()).toBe(1)
    const winner=results[0].kind==='created' ? input : null
    if (winner) expect((await mutateApproverAccess(admin,account,winner)).kind).toBe('replayed')
    expect(await owner`select active,revision from account_approver_state where account_id=${account} and profile_id=${reviewer}`).toEqual([{active:true,revision:1}])
  })
  it('replays lost grant responses and conflicts on altered request payload', async () => {
    const input=access('grant',0)
    const first=await mutateApproverAccess(admin,account,input)
    expect(first.kind).toBe('created')
    expect(await mutateApproverAccess(admin,account,input)).toEqual({...first,kind:'replayed'})
    expect((await mutateApproverAccess(admin,account,{...input,reason:'Changed reason'})).kind).toBe('conflict')
    expect(await auditCount()).toBe(1)
  })
  it.each(['demotion','moved member','deleted member'] as const)('rechecks %s between precheck and access transaction', async change => {
    const pause=pauseNextTransaction()
    const pending=mutateApproverAccess(admin,account,access('grant',0))
    await pause.entered
    try {
      if(change==='demotion') await owner`update profiles set is_admin=false where account_id=${account} and id=${admin}`
      if(change==='moved member') await owner`update profiles set account_id=${otherAccount} where account_id=${account} and id=${reviewer}`
      if(change==='deleted member') await owner`delete from profiles where account_id=${account} and id=${reviewer}`
    } finally { pause.release() }
    expect((await pending).kind).toBe(change==='demotion'?'denied':'not_found')
    expect(await auditCount()).toBe(0)
  })
  it.each(['moved','deleted'] as const)('denies a %s submitter after draft pre-read', async change => {
    const pause=pauseNextTransaction(); const pending=submit(); await pause.entered
    try {
      if(change==='moved') await owner`update profiles set account_id=${otherAccount} where account_id=${account} and id=${author}`
      else await owner`delete from profiles where account_id=${account} and id=${author}`
    } finally { pause.release() }
    expect((await pending).kind).toBe('denied')
    expect(await owner`select id from work_item_versions where account_id=${account} and work_item_id=${item}`).toHaveLength(0)
  })
  it('replays one submitted revision concurrently and retains it after a newer draft edit', async () => {
    const results=await Promise.all([submit(),submit()])
    expect(results.map(r=>r.kind).sort()).toEqual(['created','replayed'])
    await owner`update evidence_work_items set revision=2,title='Later draft' where account_id=${account} and id=${item}`
    const replay=await submit(); expect(replay).toMatchObject({kind:'replayed',value:{title:draft().title,draftRevision:1}})
    expect(await owner`select id from work_item_versions where account_id=${account} and work_item_id=${item}`).toHaveLength(1)
  })
  it.each(['revoke first','decision first'] as const)('enforces %s ordering with overlapping real store requests and exact decision retry', async order => {
    expect((await grant()).kind).toBe('created'); const saved=await version(); const input=decision()
    const decide=()=>decideVersion(account,client,item,saved.id,reviewer,input)
    const revoke=()=>mutateApproverAccess(admin,account,access('revoke',1))
    const pause=pauseNextTransaction()
    const pending=order==='revoke first'?decide():revoke()
    await pause.entered
    let first
    try { first=await (order==='revoke first'?revoke():decide()) } finally { pause.release() }
    expect(first.kind).toBe('created')
    expect((await pending).kind).toBe(order==='revoke first'?'denied':'created')
    expect((await decide()).kind).toBe(order==='revoke first'?'denied':'replayed')
    expect(await owner`select id from work_item_decisions where account_id=${account} and version_id=${saved.id}`).toHaveLength(order==='revoke first'?0:1)
    expect(await auditCount()).toBe(2)
  })
  it.each(['moved','deleted'] as const)('denies a %s reviewer after the retained version pre-read', async change => {
    await grant(); const saved=await version(); const pause=pauseNextTransaction()
    const pending=decideVersion(account,client,item,saved.id,reviewer,decision()); await pause.entered
    try {
      if(change==='moved') await owner`update profiles set account_id=${otherAccount} where account_id=${account} and id=${reviewer}`
      else await owner`delete from profiles where account_id=${account} and id=${reviewer}`
    } finally { pause.release() }
    expect((await pending).kind).toBe('denied')
    expect(await owner`select id from work_item_decisions where account_id=${account} and version_id=${saved.id}`).toHaveLength(0)
  })
  it('conflicts when a newer version commits after a decision pre-read', async () => {
    await grant(); const saved=await version(); const pause=pauseNextTransaction()
    const pending=decideVersion(account,client,item,saved.id,reviewer,decision()); await pause.entered
    try {
      await owner`update evidence_work_items set revision=2,title='Second saved draft' where account_id=${account} and id=${item}`
      expect((await submitVersion(account,client,item,author,2)).kind).toBe('created')
    } finally { pause.release() }
    expect((await pending).kind).toBe('conflict')
  })
  it.each(['40001','40P01'])('retries an injected pre-transaction %s and persists exactly one real version', async code => {
    // Transport seam injection tests retry orchestration; it does not claim a real DB deadlock.
    beforeTransaction=async()=>{throw {code}}
    const saved=await version()
    expect((await readVersion(account,client,item,saved.id,author)).kind).toBe('created')
    expect(await owner`select id from work_item_versions where account_id=${account} and work_item_id=${item}`).toHaveLength(1)
  })
})
