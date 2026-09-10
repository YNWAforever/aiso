import { randomUUID } from 'node:crypto'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertApprovedTarget } from './approved-target'
import { draft } from '../change-sets/fixtures'
import { freezeReview } from '@/lib/change-sets/validation'
import { attestDelivery, readDelivery, readDeliveryVersion, withdrawDelivery } from '@/lib/delivery/store'
import { submitVersion } from '@/lib/change-sets/store'
import type { AttestInput, DeliveryScope } from '@/lib/delivery/types'
const storeConnection = vi.hoisted(() => ({ sql: null as NeonQueryFunction<false, false> | null }))
vi.mock('@/lib/db', () => ({ db: () => {
  if (!storeConnection.sql) throw new Error('C9E_TARGET_NOT_VERIFIED')
  return storeConnection.sql
} }))
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

it('refuses to report success without an approved disposable target', () => assertApprovedTarget(optedIn, 'C9E_DISPOSABLE_PROJECT_ID, C9E_DISPOSABLE_BRANCH_ID, C9E_PARENT_BRANCH_ID, C9E_TEST_DATABASE_URL and C9E_TEST_APP_DATABASE_URL'))

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
    vi.restoreAllMocks()
    storeConnection.sql = app
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

  async function createVersion(number: number, decision: 'approved' | 'changes_requested' | null, decidedAt: string | null = null, workItemId = item) {
    const frozen=freezeReview({...draft(),id:workItemId,clientId:client,revision:number})
    const version=randomUUID(), approval=randomUUID()
    await owner`insert into work_item_versions (id,account_id,client_id,work_item_id,version_number,draft_revision,content,content_hash,validation,submitter) values (${version},${account},${client},${workItemId},${number},${number},${JSON.stringify(frozen.content)}::jsonb,${frozen.contentHash},${JSON.stringify(frozen.validation)}::jsonb,${JSON.stringify(actor(author))}::jsonb)`
    if (decision !== null) await owner`insert into work_item_decisions (id,account_id,client_id,work_item_id,version_id,content_hash,decision,reason,actor_id,actor,grant_revision,grant_event_id,request_id,decided_at) values (${approval},${account},${client},${workItemId},${version},${frozen.contentHash},${decision},'Fixture review',${reviewer},${JSON.stringify(actor(reviewer,'account_approver'))}::jsonb,1,${grant},${randomUUID()},COALESCE(${decidedAt}::timestamptz,clock_timestamp()))`
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
    await expect(owner`delete from work_item_versions where account_id=${account} and id=${version}`).rejects.toMatchObject({code:'23001'})
    await expect(owner`delete from work_item_decisions where account_id=${account} and id=${approval}`).rejects.toMatchObject({code:'23001'})
  })

  // Actual application stores below run only through the role-verified app SQL
  // injected at db(). Transaction hooks control dispatch, never fabricate rows.
  function deliveryScope(): DeliveryScope {
    return { accountId: account, clientId: client, itemId: item, versionId: version, actorId: author }
  }
  function deliveryInput(overrides: Partial<AttestInput> = {}): AttestInput {
    return { contentHash: hash, destination: 'Client CMS', deliveredAt: new Date(deliveredAt).toISOString(),
      note: 'Declared manual delivery', requestId: randomUUID(), ...overrides }
  }
  async function eventCount() {
    const [row] = await app`select count(*)::integer count from work_item_delivery_events where account_id=${account} and client_id=${client} and work_item_id=${item}`
    return row.count as number
  }
  async function prepareNextDraft() {
    await owner`update evidence_work_items set revision=2 where account_id=${account} and client_id=${client} and id=${item}`
  }
  function pauseNextTransaction() {
    let reached!: () => void, release!: () => void
    const ready = new Promise<void>(resolve => { reached = resolve })
    const wait = new Promise<void>(resolve => { release = resolve })
    const transaction = app.transaction.bind(app)
    vi.spyOn(app, 'transaction').mockImplementationOnce(async (queries, options) => {
      reached(); await wait
      return transaction(queries, options)
    })
    return { ready, release }
  }

  it('actual stores serialize simultaneous attestations to one active winner', async () => {
    const scope = deliveryScope()
    const results = await Promise.all([attestDelivery(scope, deliveryInput()), attestDelivery(scope, deliveryInput())])
    expect(results.map(result => result.kind).sort()).toEqual(['conflict', 'created'])
    expect(await eventCount()).toBe(1)
    const page = await readDelivery(scope, { limit: 20, cursor: null })
    expect(page).toMatchObject({ kind: 'replayed', value: { capabilities: { canAttest: false, canWithdraw: true } } })
    if (!('value' in page)) throw new Error('Expected owned page')
    expect(page.value.activeAttestationId).toBe(page.value.events[0].eventId)
  })

  it.each(['submission-first', 'delivery-first'])('actual submission and delivery respect controlled dispatch order %s', async order => {
    await prepareNextDraft()
    const scope = deliveryScope(), payload = deliveryInput(), pause = pauseNextTransaction()
    // This orchestration controls transaction dispatch, not a claimed real deadlock.
    // The simultaneous store tests separately exercise competing item locks.
    const first = order === 'submission-first'
      ? attestDelivery(scope, payload)
      : submitVersion(account, client, item, author, 2)
    await pause.ready
    try {
      const second = order === 'submission-first'
        ? await submitVersion(account, client, item, author, 2)
        : await attestDelivery(scope, payload)
      expect(second.kind).toBe('created')
    } finally { pause.release() }
    const final = await first
    expect(final.kind).toBe(order === 'submission-first' ? 'conflict' : 'created')
    expect(await eventCount()).toBe(order === 'submission-first' ? 0 : 1)
  })

  it('actual stores serialize simultaneous withdrawal and permit an eligible correction', async () => {
    const scope = deliveryScope(), first = await attestDelivery(scope, deliveryInput())
    if (!('value' in first)) throw new Error('Expected created attestation')
    const target = first.value.eventId
    const results = await Promise.all([
      withdrawDelivery(scope, target, { reason: 'Wrong destination', requestId: randomUUID() }),
      withdrawDelivery(scope, target, { reason: 'Wrong destination', requestId: randomUUID() }),
    ])
    expect(results.map(result => result.kind).sort()).toEqual(['conflict', 'created'])
    const corrected = await attestDelivery(scope, deliveryInput({ destination: 'Correct CMS' }))
    expect(corrected.kind).toBe('created')
    expect(await eventCount()).toBe(3)
    const history = await readDelivery(scope, { limit: 1, cursor: null })
    if (!('value' in history) || !('value' in corrected)) throw new Error('Expected history/correction')
    expect(history.value.activeAttestationId).toBe(corrected.value.eventId)
    expect(history.value.nextCursor).not.toBeNull()
  })

  it.each(['move', 'delete'])('actual store denies a profile %s after package pre-read and before locks', async action => {
    const transaction = app.transaction.bind(app)
    vi.spyOn(app, 'transaction').mockImplementationOnce(async (queries, options) => {
      if (action === 'move') await owner`update profiles set account_id=${otherAccount} where id=${author} and account_id=${account}`
      else await owner`delete from profiles where id=${author} and account_id=${account}`
      return transaction(queries, options)
    })
    expect(await attestDelivery(deliveryScope(), deliveryInput())).toEqual({ kind: 'denied' })
    expect(await eventCount()).toBe(0)
  })

  it('actual historical retries remain replayed after withdrawal and supersession without new events', async () => {
    const scope = deliveryScope(), payload = deliveryInput()
    const first = await attestDelivery(scope, payload)
    if (!('value' in first)) throw new Error('Expected created attestation')
    const withdrawalInput = { reason: 'Correction needed', requestId: randomUUID() }
    const withdrawn = await withdrawDelivery(scope, first.value.eventId, withdrawalInput)
    expect(withdrawn.kind).toBe('created')
    await prepareNextDraft()
    expect((await submitVersion(account, client, item, author, 2)).kind).toBe('created')
    expect(await attestDelivery(scope, payload)).toEqual({ kind: 'replayed', value: first.value })
    if (!('value' in withdrawn)) throw new Error('Expected withdrawal')
    expect(await withdrawDelivery(scope, first.value.eventId, withdrawalInput)).toEqual({ kind: 'replayed', value: withdrawn.value })
    expect(await attestDelivery(scope, { ...payload, requestId: randomUUID() })).toEqual({ kind: 'conflict' })
    expect(await eventCount()).toBe(2)
    expect(await readDelivery(scope, { limit: 20, cursor: null })).toMatchObject({ value: { activeAttestationId: null, capabilities: { canExport: true, canAttest: false, attestReason: 'superseded' } } })
  })

  it('actual requests conflict on changed fields, opposite operation and different owned version', async () => {
    const scope = deliveryScope(), payload = deliveryInput(), created = await attestDelivery(scope, payload)
    if (!('value' in created)) throw new Error('Expected created event')
    for (const patch of [{ destination: 'Other' }, { note: 'Changed' }, { deliveredAt: '2020-01-01T00:00:00Z' }, { contentHash: 'b'.repeat(64) }]) {
      expect(await attestDelivery(scope, { ...payload, ...patch })).toEqual({ kind: 'conflict' })
    }
    expect(await withdrawDelivery(scope, created.value.eventId, { reason: 'Opposite operation', requestId: payload.requestId })).toEqual({ kind: 'conflict' })
    const next = await createVersion(2, 'approved')
    expect(await attestDelivery({ ...scope, versionId: next.version }, { ...payload, contentHash: next.hash })).toEqual({ kind: 'conflict' })
    expect(await eventCount()).toBe(1)
  })

  it.each([null, 'changes_requested'] as const)('actual latest decision %s cannot authorize delivery', async decision => {
    const next = await createVersion(2, decision)
    expect(await attestDelivery({ ...deliveryScope(), versionId: next.version }, deliveryInput({ contentHash: next.hash }))).toEqual({ kind: 'conflict' })
    expect(await attestDelivery(deliveryScope(), deliveryInput())).toEqual({ kind: 'conflict' })
    expect(await eventCount()).toBe(0)
  })

  it('actual reads and mutations reject tampered tenant/hash independently of platform admin status', async () => {
    await owner`update profiles set is_admin=true where id=${author} and account_id=${account}`
    expect(await readDeliveryVersion({ ...deliveryScope(), accountId: otherAccount })).toEqual({ kind: 'denied' })
    expect(await attestDelivery({ ...deliveryScope(), accountId: otherAccount }, deliveryInput())).toEqual({ kind: 'denied' })
    expect(await attestDelivery({ ...deliveryScope(), clientId: randomUUID() }, deliveryInput())).toEqual({ kind: 'not_found' })
    expect(await attestDelivery(deliveryScope(), deliveryInput({ contentHash: 'b'.repeat(64) }))).toEqual({ kind: 'conflict' })
    expect(await eventCount()).toBe(0)
  })

  it('actual delivery validates lower time bound at approval microsecond precision and database future bound', async () => {
    const next = await createVersion(2, 'approved', '2020-01-01T00:00:00.000001Z')
    const scope = { ...deliveryScope(), versionId: next.version }
    expect(await attestDelivery(scope, deliveryInput({ contentHash: next.hash, deliveredAt: '2020-01-01T00:00:00.000Z' }))).toEqual({ kind: 'validation_failed' })
    expect(await attestDelivery(scope, deliveryInput({ contentHash: next.hash, deliveredAt: '2999-01-01T00:00:00.000Z' }))).toEqual({ kind: 'validation_failed' })
    expect((await attestDelivery(scope, deliveryInput({ contentHash: next.hash, deliveredAt: '2020-01-01T00:00:00.001Z' }))).kind).toBe('created')
    expect(await eventCount()).toBe(1)
  })

  it('actual approved delivery does not require the historical reviewer to retain an active grant', async () => {
    const revoke = randomUUID()
    await owner`insert into account_approver_events (id,account_id,profile_id,action,previous_revision,new_revision,administrator_id,administrator,reason,request_id) values (${revoke},${account},${reviewer},'revoke',1,2,${author},${JSON.stringify(actor(author,'platform_admin'))}::jsonb,'Fixture revoke',${randomUUID()})`
    await owner`insert into account_approver_state (account_id,profile_id,active,revision,last_event_id) values (${account},${reviewer},false,2,${revoke})`
    expect((await attestDelivery(deliveryScope(), deliveryInput())).kind).toBe('created')
  })

  it.each(['40001', '40P01'])('actual store persists once after two orchestration-injected %s retries', async code => {
    const transaction = app.transaction.bind(app)
    let attempts = 0
    vi.spyOn(app, 'transaction').mockImplementation(async (queries, options) => {
      attempts += 1
      if (attempts <= 2) throw Object.assign(new Error('orchestration-injected transient failure'), { code })
      return transaction(queries, options)
    })
    expect((await attestDelivery(deliveryScope(), deliveryInput())).kind).toBe('created')
    expect(attempts).toBe(3)
    expect(await eventCount()).toBe(1)
  })
  it('actual request identity is global to account/actor even across another owned work item', async () => {
    const payload = deliveryInput()
    expect((await attestDelivery(deliveryScope(), payload)).kind).toBe('created')
    const otherItem = randomUUID(), otherDraft = { ...draft(), id: otherItem, clientId: client }
    await owner`insert into evidence_work_items (id,account_id,client_id,opportunity_key,source_kind,source_id,rule_version,evidence_fingerprint,evidence_snapshot,title,action,notes,locale)
      values (${otherItem},${account},${client},${randomUUID()},'pulse-metric',${otherDraft.evidenceSnapshot.source.id},'pulse-brand-absent.v1',${'a'.repeat(64)},${JSON.stringify(otherDraft.evidenceSnapshot)}::jsonb,${otherDraft.title},${otherDraft.action},${otherDraft.notes},${otherDraft.locale})`
    const otherVersion = await createVersion(1, 'approved', null, otherItem)
    expect(await attestDelivery({ ...deliveryScope(), itemId: otherItem, versionId: otherVersion.version }, { ...payload, contentHash: otherVersion.hash })).toEqual({ kind: 'conflict' })
    expect(await app`select id from work_item_delivery_events where account_id=${account} and client_id=${client} and work_item_id=${otherItem}`).toHaveLength(0)
  })

  it('actual keyset pagination retains equal-microsecond rows and full-history active state', async () => {
    const scope = deliveryScope(), first = await attestDelivery(scope, deliveryInput())
    if (!('value' in first)) throw new Error('Expected first event')
    const original = first.value.eventId, withdrawalId = randomUUID(), replacementId = randomUUID()
    // Schema-valid fixture inserts intentionally tie recorded_at exactly; no history is edited.
    await app`insert into work_item_delivery_events (id,account_id,client_id,work_item_id,version_id,content_hash,kind,actor_id,actor,request_id,recorded_at,target_attestation_id,target_kind,reason)
      select ${withdrawalId},account_id,client_id,work_item_id,version_id,content_hash,'withdraw',actor_id,actor,${randomUUID()},recorded_at,id,'attest','Fixture tie correction'
      from work_item_delivery_events where account_id=${account} and client_id=${client} and work_item_id=${item} and id=${original}`
    await app`insert into work_item_delivery_events (id,account_id,client_id,work_item_id,version_id,content_hash,approval_decision_id,approval_decision,kind,actor_id,actor,request_id,recorded_at,destination,delivered_at,note)
      select ${replacementId},account_id,client_id,work_item_id,version_id,content_hash,approval_decision_id,approval_decision,'attest',actor_id,actor,${randomUUID()},recorded_at,'Corrected tie destination',delivered_at,note
      from work_item_delivery_events where account_id=${account} and client_id=${client} and work_item_id=${item} and id=${original}`
    const ids: string[] = []
    let cursor: { recordedAt: string; id: string } | null = null
    do {
      const page = await readDelivery(scope, { limit: 1, cursor })
      if (!('value' in page)) throw new Error('Expected keyset page')
      expect(page.value.activeAttestationId).toBe(replacementId)
      expect(page.value.events).toHaveLength(1)
      expect(page.value.events[0].recordedAt).toBe(first.value.recordedAt)
      ids.push(page.value.events[0].eventId)
      cursor = page.value.nextCursor ? JSON.parse(Buffer.from(page.value.nextCursor, 'base64url').toString('utf8')) : null
      expect(ids.length).toBeLessThanOrEqual(3)
    } while (cursor)
    expect(ids).toEqual([original, withdrawalId, replacementId].sort().reverse())
  })

  it('actual malformed retained package is validation_failed and cannot create an event', async () => {
    const malformedVersion = randomUUID(), malformedApproval = randomUUID(), frozen = freezeReview({ ...draft(), id: item, clientId: client, revision: 2 })
    const mismatchedHash = 'b'.repeat(64)
    await owner`insert into work_item_versions (id,account_id,client_id,work_item_id,version_number,draft_revision,content,content_hash,validation,submitter)
      values (${malformedVersion},${account},${client},${item},2,2,${JSON.stringify(frozen.content)}::jsonb,${mismatchedHash},${JSON.stringify(frozen.validation)}::jsonb,${JSON.stringify(actor(author))}::jsonb)`
    await owner`insert into work_item_decisions (id,account_id,client_id,work_item_id,version_id,content_hash,decision,reason,actor_id,actor,grant_revision,grant_event_id,request_id)
      values (${malformedApproval},${account},${client},${item},${malformedVersion},${mismatchedHash},'approved','Fixture corrupted package',${reviewer},${JSON.stringify(actor(reviewer,'account_approver'))}::jsonb,1,${grant},${randomUUID()})`
    const scope = { ...deliveryScope(), versionId: malformedVersion }
    expect(await readDeliveryVersion(scope)).toEqual({ kind: 'validation_failed' })
    expect(await attestDelivery(scope, deliveryInput({ contentHash: mismatchedHash }))).toEqual({ kind: 'validation_failed' })
    expect(await eventCount()).toBe(0)
  })})
