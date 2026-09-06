import { randomUUID } from 'node:crypto'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { draft } from '../change-sets/fixtures'
import { freezeReview } from '@/lib/change-sets/validation'
vi.mock('server-only', () => ({}))

// AUTHORED / UNRUN. Exact disposable target approval and migrations through 043 are external gates.
// No provisioning, environment-file loading, migration application or cleanup here.
const project = process.env.C9E_DISPOSABLE_PROJECT_ID
const branch = process.env.C9E_DISPOSABLE_BRANCH_ID
const ownerUrl = process.env.C9E_TEST_DATABASE_URL
const appUrl = process.env.C9E_TEST_APP_DATABASE_URL
const optedIn = Boolean(project || branch || ownerUrl || appUrl)

type EventInput = {
  id: string; account: string; client: string; item: string; version: string; hash: string
  approval: string | null; approvalDecision: string | null; kind: string
  actorId: string; actor: unknown; request: string; destination: string | null
  deliveredAt: string | null; note: string | null; target: string | null; targetKind: string | null; reason: string | null
}

describe.skipIf(!optedIn)('delivery constraints on an exact disposable target', () => {
  let owner: NeonQueryFunction<false, false>, app: NeonQueryFunction<false, false>
  let verified = false
  let account: string, otherAccount: string, client: string, item: string, author: string, reviewer: string
  let version: string, hash: string, approval: string, deliveredAt: string, grant: string
  const actor = (profileId: string, role = 'account_member') => ({profileId,displayName:'Delivery fixture',role})

  beforeAll(async () => {
    const protectedBranches = new Set(['br-square-mountain-az6f82vi', process.env.NEON_TEST_PRODUCTION_BRANCH_ID, process.env.C9E_PARENT_BRANCH_ID, process.env.NEON_DEFAULT_BRANCH_ID])
    if (!project || !branch || !ownerUrl || !appUrl || !/^br-[a-z0-9-]+$/.test(branch) || protectedBranches.has(branch) || /production|staging|main|default/i.test(branch)) throw new Error('Exact disposable C9e target required')
    const urls = [new URL(ownerUrl), new URL(appUrl)]
    for (const url of urls) {
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech') || !url.pathname.slice(1)) throw new Error('Dedicated Neon test connections required')
    }
    const expectedDatabase = decodeURIComponent(urls[0].pathname.slice(1))
    if (decodeURIComponent(urls[1].pathname.slice(1)) !== expectedDatabase) throw new Error('Owner/application database mismatch')
    owner = neon(ownerUrl); app = neon(appUrl)
    // Verify both in-band identities and roles BEFORE allowing any fixture write.
    for (const [sql, isApp] of [[owner, false], [app, true]] as const) {
      const [identity] = await sql`select current_setting('neon.project_id',true) project, current_setting('neon.branch_id',true) branch, current_database() database, current_user role,
        (select pg_get_userbyid(relowner)=current_user from pg_class where oid='public.work_item_delivery_events'::regclass) owns_delivery`
      if (identity.project !== project || identity.branch !== branch || identity.database !== expectedDatabase || (isApp ? identity.role !== 'aeo_app' : !identity.owns_delivery || identity.role === 'aeo_app')) throw new Error('Disposable C9e identity/schema mismatch')
    }
    verified = true
  })

  beforeEach(async () => {
    if (!verified) throw new Error('C9E_TARGET_NOT_VERIFIED')
    account=randomUUID(); otherAccount=randomUUID(); client=randomUUID(); item=randomUUID(); author=randomUUID(); reviewer=randomUUID(); grant=randomUUID()
    await owner`insert into accounts (id,plan) values (${account},'basic'),(${otherAccount},'basic')`
    await owner`insert into clients (id,account_id,brand_name) values (${client},${account},'C9e fixture')`
    for (const id of [author,reviewer]) {
      await owner`insert into neon_auth.user (id,email,name,"emailVerified") values (${id},${`${id}@example.test`},'Delivery fixture',false)`
      await owner`insert into profiles (id,account_id,display_name) values (${id},${account},'Delivery fixture')`
    }
    const value = {...draft(),id:item,clientId:client}
    await owner`insert into evidence_work_items (id,account_id,client_id,opportunity_key,source_kind,source_id,rule_version,evidence_fingerprint,evidence_snapshot,title,action,notes,locale) values (${item},${account},${client},${randomUUID()},'pulse-metric',${value.evidenceSnapshot.source.id},'pulse-brand-absent.v1',${'a'.repeat(64)},${JSON.stringify(value.evidenceSnapshot)}::jsonb,${value.title},${value.action},${value.notes},${value.locale})`
    await owner`insert into account_approver_events (id,account_id,profile_id,action,previous_revision,new_revision,administrator_id,administrator,reason,request_id) values (${grant},${account},${reviewer},'grant',0,1,${author},${JSON.stringify(actor(author,'platform_admin'))}::jsonb,'Fixture grant',${randomUUID()})`
    const approved = await createVersion(1, 'approved')
    version=approved.version; hash=approved.hash; approval=approved.approval
    const [clock] = await owner`select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') time`
    deliveredAt=clock.time
  })

  async function createVersion(number: number, decision: 'approved' | 'changes_requested') {
    const frozen=freezeReview({...draft(),id:item,clientId:client,revision:number})
    const version=randomUUID(), approval=randomUUID()
    await owner`insert into work_item_versions (id,account_id,client_id,work_item_id,version_number,draft_revision,content,content_hash,validation,submitter) values (${version},${account},${client},${item},${number},${number},${JSON.stringify(frozen.content)}::jsonb,${frozen.contentHash},${JSON.stringify(frozen.validation)}::jsonb,${JSON.stringify(actor(author))}::jsonb)`
    await owner`insert into work_item_decisions (id,account_id,client_id,work_item_id,version_id,content_hash,decision,reason,actor_id,actor,grant_revision,grant_event_id,request_id) values (${approval},${account},${client},${item},${version},${frozen.contentHash},${decision},'Fixture review',${reviewer},${JSON.stringify(actor(reviewer,'account_approver'))}::jsonb,1,${grant},${randomUUID()})`
    return {version,hash:frozen.contentHash,approval}
  }
  function input(overrides: Partial<EventInput> = {}): EventInput {
    return {id:randomUUID(),account,client,item,version,hash,approval,approvalDecision:'approved',kind:'attest',actorId:author,actor:actor(author),request:randomUUID(),destination:'Client CMS',deliveredAt,note:'Declared manual delivery',target:null,targetKind:null,reason:null,...overrides}
  }
  function withdrawal(target: string, overrides: Partial<EventInput> = {}) {
    return input({kind:'withdraw',approval:null,approvalDecision:null,destination:null,deliveredAt:null,note:null,target,targetKind:'attest',reason:'Correcting destination',...overrides})
  }
  function insert(row: EventInput) {
    return app`insert into work_item_delivery_events (id,account_id,client_id,work_item_id,version_id,content_hash,approval_decision_id,approval_decision,kind,actor_id,actor,request_id,destination,delivered_at,note,target_attestation_id,target_kind,reason)
      values (${row.id},${row.account},${row.client},${row.item},${row.version},${row.hash},${row.approval},${row.approvalDecision},${row.kind},${row.actorId},${JSON.stringify(row.actor)}::jsonb,${row.request},${row.destination},${row.deliveredAt}::timestamptz,${row.note},${row.target},${row.targetKind},${row.reason}) returning id`
  }

  it('accepts approved exact version attestation and same-scope withdrawal', async () => {
    const row=input(); expect(await insert(row)).toEqual([{id:row.id}])
    expect(await insert(withdrawal(row.id))).toHaveLength(1)
  })
  it.each(['account','client','item','version','approval'] as const)('rejects exact FK mismatch in %s', async field => {
    await expect(insert(input({[field]:randomUUID()}))).rejects.toMatchObject({code:'23503'})
  })
  it('rejects changed content hash and a changes-requested decision as approval', async () => {
    await expect(insert(input({hash:'b'.repeat(64)}))).rejects.toMatchObject({code:'23503'})
    const rejected=await createVersion(2,'changes_requested')
    await expect(insert(input(rejected))).rejects.toMatchObject({code:'23503'})
    await expect(insert(input({...rejected,approvalDecision:'changes_requested'}))).rejects.toMatchObject({code:'23514'})
  })
  it.each(['approval','approvalDecision','destination','deliveredAt','note'] as const)('closes NULL attestation bypass for %s', async field => {
    await expect(insert(input({[field]:null}))).rejects.toMatchObject({code:'23514'})
  })
  it.each([{}, [], null, {profileId:null,displayName:null,role:'account_member'}, {profileId:'bad',displayName:null,role:'account_member'}])('rejects invalid actor JSON %j', async value => {
    await expect(insert(input({actor:value}))).rejects.toMatchObject({code:'23514'})
  })
  it('requires the recorded account-member role and matching identity', async () => {
    await expect(insert(input({actor:actor(author,'platform_admin')}))).rejects.toMatchObject({code:'23514'})
    await expect(insert(input({actor:actor(reviewer)}))).rejects.toMatchObject({code:'23514'})
  })
  it.each([{destination:''},{destination:'x'.repeat(501)},{destination:' untrimmed'},{destination:'e\u0301'},{note:''},{note:'x'.repeat(2001)},{note:' trailing '},{note:'e\u0301'},{reason:'opposite kind'},{target:randomUUID()},{targetKind:'attest'},{deliveredAt:'2999-01-01T00:00:00Z'}])('rejects invalid attestation fields %j', async fields => {
    await expect(insert(input(fields))).rejects.toMatchObject({code:'23514'})
  })
  it('counts Unicode code points rather than bytes for valid limits', async () => {
    expect(await insert(input({destination:'界'.repeat(500),note:'𠮷'.repeat(2000)}))).toHaveLength(1)
  })
  it('rejects duplicate account/actor request IDs across event kinds', async () => {
    const row=input(); await insert(row)
    await expect(insert(input({request:row.request}))).rejects.toMatchObject({code:'23505'})
    await expect(insert(withdrawal(row.id,{request:row.request}))).rejects.toMatchObject({code:'23505'})
  })
  it('rejects repeated withdrawal, self-reference, and withdrawal-of-withdrawal', async () => {
    const row=input(); await insert(row)
    const withdrawn=withdrawal(row.id); await insert(withdrawn)
    await expect(insert(withdrawal(row.id))).rejects.toMatchObject({code:'23505'})
    await expect(insert(withdrawal(withdrawn.id))).rejects.toMatchObject({code:'23503'})
    const id=randomUUID()
    await expect(insert(withdrawal(id,{id}))).rejects.toMatchObject({code:'23514'})
  })
  it('binds withdrawal target scope and version/hash exactly', async () => {
    const row=input(); await insert(row)
    const second=await createVersion(2,'approved')
    await expect(insert(withdrawal(row.id,{version:second.version,hash:second.hash}))).rejects.toMatchObject({code:'23503'})
    await expect(insert(withdrawal(row.id,{account:otherAccount}))).rejects.toMatchObject({code:'23503'})
  })
  it.each([{target:null},{targetKind:null},{targetKind:'withdraw'},{reason:null},{reason:''},{reason:'x'.repeat(2001)},{reason:' untrimmed'},{reason:'e\u0301'},{destination:'wrong kind'},{note:'wrong kind'},{deliveredAt:'2026-01-01T00:00:00Z'},{approval:randomUUID()},{approvalDecision:'approved'}])('closes withdrawal NULL/opposite-kind/limit bypass %j', async fields => {
    const row=input(); await insert(row)
    await expect(insert(withdrawal(row.id,fields))).rejects.toMatchObject({code:'23514'})
  })
  it('enforces append-only application privileges including inherited grants', async () => {
    const [grants]=await owner`select has_table_privilege('aeo_app','public.work_item_delivery_events','SELECT') r, has_table_privilege('aeo_app','public.work_item_delivery_events','INSERT') i, has_table_privilege('aeo_app','public.work_item_delivery_events','UPDATE') u, has_table_privilege('aeo_app','public.work_item_delivery_events','DELETE') d, has_table_privilege('aeo_app','public.work_item_delivery_events','TRUNCATE') t`
    expect(grants).toEqual({r:true,i:true,u:false,d:false,t:false})
    const row=input(); await insert(row)
    await expect(app`update work_item_delivery_events set note='changed' where account_id=${account} and id=${row.id}`).rejects.toMatchObject({code:'42501'})
    await expect(app`delete from work_item_delivery_events where account_id=${account} and id=${row.id}`).rejects.toMatchObject({code:'42501'})
  })
  it('retains actor deletion snapshots and restricts version/approval deletion', async () => {
    const row=input(); await insert(row)
    await owner`delete from profiles where id=${author} and account_id=${account}`
    expect(await app`select actor from work_item_delivery_events where account_id=${account} and id=${row.id}`).toEqual([{actor:actor(author)}])
    await expect(owner`delete from work_item_versions where account_id=${account} and id=${version}`).rejects.toMatchObject({code:'23503'})
    await expect(owner`delete from work_item_decisions where account_id=${account} and id=${approval}`).rejects.toMatchObject({code:'23503'})
  })
})
