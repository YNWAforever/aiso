import { createHash, randomUUID } from 'node:crypto'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { assertApprovedTarget } from './approved-target'
import { draft } from '../change-sets/fixtures'
import { freezeMultiSourceReview, freezeReview } from '@/lib/change-sets/validation'
import { attestDelivery, readDelivery, readDeliveryVersion, recordExportEvent, withdrawDelivery } from '@/lib/delivery/store'
import { createDeliveryExport } from '@/lib/delivery/export'
import type { ActorSnapshot } from '@/lib/change-sets/types'
import type { WorkItem } from '@/lib/work-items/schema'
import { approvedMultiSourceVersion } from '../delivery/multi-source-fixtures'
import { submitVersion } from '@/lib/change-sets/store'
import type { AttestInput, DeliveryScope } from '@/lib/delivery/types'
import { buildScanEvidence, CHECK_VERSIONS } from '@/lib/scan-evidence'
import { deriveSuggestions } from '@/lib/opportunities/rules'
import { buildInitialDraftSnapshot } from '@/lib/work-items/snapshot'
import { readOutcomeInput } from '@/lib/outcomes/store'
import { evaluateOutcomes } from '@/lib/outcomes/evaluate'
import { parseOutcomeResponse } from '@/lib/outcomes/dto'
import { evaluateMultiSourceOutcomes, multiSourceOutcomeContext, parseMultiSourceOutcomeResponse, type MultiSourceOutcomeInput } from '@/lib/outcomes/multi-source'
const storeConnection = vi.hoisted(() => ({ sql: null as NeonQueryFunction<false, false> | null }))
vi.mock('@/lib/db', () => ({ db: () => {
  if (!storeConnection.sql) throw new Error('C9E_TARGET_NOT_VERIFIED')
  return storeConnection.sql
} }))
vi.mock('server-only', () => ({}))

// Exact disposable target approval and schema replay are external harness gates.
// Export-receipt cases additionally exercise 045's ledger and 051's V2 content.
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
        (select pg_get_userbyid(relowner)=current_user from pg_class where oid='public.work_item_delivery_events'::regclass) owns_delivery,
        (select rolbypassrls from pg_roles where rolname=current_user) bypass_rls`
      if (identity.project !== project || identity.branch !== branch || identity.database !== expectedDatabase || (isApp ? identity.role !== 'aeo_app' || identity.bypass_rls !== true : !identity.owns_delivery || identity.role === 'aeo_app')) throw new Error('Disposable C9e identity/schema mismatch')
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

  async function createVersion(number: number, decision: 'approved' | 'changes_requested' | null, decidedAt: string | null = null, workItemId = item, sources?: WorkItem['evidenceSnapshot'][], submittedAt: string | null = null) {
    const value = { ...draft(), id: workItemId, clientId: client, revision: number }
    const frozen = sources ? freezeMultiSourceReview(value, sources) : freezeReview(value)
    const version=randomUUID(), approval=randomUUID()
    await owner`insert into work_item_versions (id,account_id,client_id,work_item_id,version_number,draft_revision,content,content_hash,validation,submitter,submitted_at) values (${version},${account},${client},${workItemId},${number},${number},${JSON.stringify(frozen.content)}::jsonb,${frozen.contentHash},${JSON.stringify(frozen.validation)}::jsonb,${JSON.stringify(actor(author))}::jsonb,COALESCE(${submittedAt}::timestamptz,now()))`
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

  // Exercise the real app SQL -> retained DTO -> renderer -> append-only receipt
  // path. These are export observations, never manual delivery attestations.
  async function exportFixture(schemaVersion: 1 | 2) {
    const sources = schemaVersion === 2 ? approvedMultiSourceVersion().evidenceSnapshots : undefined
    let versionId = version
    if (sources) {
      await prepareNextDraft()
      versionId = (await createVersion(2, 'approved', null, item, sources)).version
    }
    const downloader: ActorSnapshot = { profileId: randomUUID(), displayName: 'Export downloader', role: 'account_member' }
    await owner`insert into neon_auth.user (id,email,name,"emailVerified") values (${downloader.profileId},${`${downloader.profileId}@example.test`},'Export downloader',false)`
    await owner`insert into profiles (id,account_id,display_name) values (${downloader.profileId},${account},'Export downloader')`
    const scope = { ...deliveryScope(), versionId, actorId: downloader.profileId }
    const result = await readDeliveryVersion(scope)
    if (!('value' in result)) throw new Error('Expected approved retained export fixture')
    expect(result.value.schemaVersion).toBe(schemaVersion)
    expect(result.value.decision?.decision).toBe('approved')
    expect(result.value.submittedBy.profileId).not.toBe(downloader.profileId)
    expect(result.value.decision?.decidedBy.profileId).not.toBe(downloader.profileId)
    if (result.value.schemaVersion === 2) expect(result.value.evidenceSnapshots).toEqual(sources)
    return { scope, retained: result.value, downloader }
  }
  function exportRows(scope: DeliveryScope) {
    return app`select id,schema_version,account_id,client_id,work_item_id,version_id,content_hash,
      artifact_hash,format,renderer_version,actor_id,actor,
      to_char(exported_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') exported_at
      from work_item_export_events where account_id=${scope.accountId} and client_id=${scope.clientId}
        and work_item_id=${scope.itemId} and version_id=${scope.versionId} and actor_id=${scope.actorId}
      order by exported_at,id`
  }
  it.each([[1, 'json'], [1, 'text'], [2, 'json'], [2, 'text']] as const)('persists a V%i %s export receipt through the actual application role', async (schemaVersion, format) => {
    const { scope, retained, downloader } = await exportFixture(schemaVersion)
    const artifact = createDeliveryExport(retained, format)
    expect(await recordExportEvent(scope, { contentHash: retained.contentHash, artifactHash: artifact.exportHash,
      format, rendererVersion: artifact.rendererVersion, actor: downloader })).toBe(true)
    const rows = await exportRows(scope)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ schema_version: 1, account_id: account, client_id: client, work_item_id: item,
      version_id: retained.id, content_hash: retained.contentHash, artifact_hash: artifact.exportHash,
      format, renderer_version: `delivery-export.v${schemaVersion}`, actor_id: downloader.profileId, actor: downloader })
    expect(rows[0].exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/)
    expect(await eventCount()).toBe(0)
  })
  it('records repeated V2 downloads separately while both formats identify the same canonical envelope', async () => {
    const { scope, retained, downloader } = await exportFixture(2)
    for (const format of ['json', 'text', 'json'] as const) {
      const artifact = createDeliveryExport(retained, format)
      expect(await recordExportEvent(scope, { contentHash: retained.contentHash, artifactHash: artifact.exportHash,
        format, rendererVersion: artifact.rendererVersion, actor: downloader })).toBe(true)
    }
    const rows = await exportRows(scope)
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map(row => row.id)).size).toBe(3)
    expect(new Set(rows.map(row => row.artifact_hash)).size).toBe(1)
    expect(rows.filter(row => row.format === 'json')).toHaveLength(2)
    expect(rows.filter(row => row.format === 'text')).toHaveLength(1)
    expect(rows.every(row => row.renderer_version === 'delivery-export.v2' && row.actor_id === downloader.profileId)).toBe(true)
    expect(await eventCount()).toBe(0)
  })
  it('returns false and writes no receipt for mismatched V2 tenant/version/hash bindings', async () => {
    const { scope, retained, downloader } = await exportFixture(2)
    const artifact = createDeliveryExport(retained, 'json')
    const input = { contentHash: retained.contentHash, artifactHash: artifact.exportHash,
      format: 'json' as const, rendererVersion: artifact.rendererVersion, actor: downloader }
    for (const field of ['accountId', 'clientId', 'itemId', 'versionId'] as const) {
      expect(await recordExportEvent({ ...scope, [field]: field === 'accountId' ? otherAccount : randomUUID() }, input)).toBe(false)
    }
    const changedHash = retained.contentHash.replace(/^./, value => value === '0' ? '1' : '0')
    expect(await recordExportEvent(scope, { ...input, contentHash: changedHash })).toBe(false)
    expect(await exportRows(scope)).toEqual([])
    expect(await eventCount()).toBe(0)
  })
  it('keeps actual V2 export receipts append-only for the application role', async () => {
    const { scope, retained, downloader } = await exportFixture(2)
    const artifact = createDeliveryExport(retained, 'text')
    expect(await recordExportEvent(scope, { contentHash: retained.contentHash, artifactHash: artifact.exportHash,
      format: 'text', rendererVersion: artifact.rendererVersion, actor: downloader })).toBe(true)
    const [grants] = await app`select current_user role,
      has_table_privilege(current_user,'public.work_item_export_events','SELECT') r,
      has_table_privilege(current_user,'public.work_item_export_events','INSERT') i,
      has_table_privilege(current_user,'public.work_item_export_events','UPDATE') u,
      has_table_privilege(current_user,'public.work_item_export_events','DELETE') d,
      has_table_privilege(current_user,'public.work_item_export_events','TRUNCATE') t`
    expect(grants).toEqual({ role: 'aeo_app', r: true, i: true, u: false, d: false, t: false })
    const before = await exportRows(scope), id = before[0].id
    await expect(app`update work_item_export_events set renderer_version='changed'
      where account_id=${account} and client_id=${client} and work_item_id=${item} and version_id=${retained.id} and id=${id}`).rejects.toMatchObject({ code: '42501' })
    await expect(app`delete from work_item_export_events
      where account_id=${account} and client_id=${client} and work_item_id=${item} and version_id=${retained.id} and id=${id}`).rejects.toMatchObject({ code: '42501' })
    expect(await exportRows(scope)).toEqual(before)
    expect(await eventCount()).toBe(0)
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
  })

  // V2 witnesses use the same verified disposable transports. No mocked query
  // results, auth SDK requests, clock injection, DDL, role changes or constraint bypass.
  type OutcomeClock = { baseline: string; submitted: string; approved: string; delivered: string; recorded: string; observed: string }
  type Snapshot = WorkItem['evidenceSnapshot']
  type OutcomeRows = { evaluated_at: string; scans: { id: string }[]; pulse: { id: string; question: string; platform: string; prompt_id: string | null }[]; events: { id: string }[] }
  type SourceFactory = (base: { scan: Snapshot; pulse: Snapshot; clock: OutcomeClock; prompt: string; otherPrompt: string }) => Snapshot[]

  function pulseSnapshot(at: string, overrides: { id?: string; promptId?: string | null; question?: string; platform?: string } = {}): Snapshot {
    const value = draft().evidenceSnapshot
    if (value.evidence.kind !== 'pulse-metric') throw new Error('Expected canonical Pulse fixture')
    const id = overrides.id ?? randomUUID(), question = overrides.question ?? 'Stored outcome question?', platform = overrides.platform ?? 'chatgpt'
    const monday = new Date(at); monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
    return { ...value, source: { kind: 'pulse-metric', id }, args: { question, platform },
      evidence: { ...value.evidence, id, question, platform, promptId: overrides.promptId ?? null, recordedAt: at,
        scanWeek: monday.toISOString().slice(0, 10), answerDigest: createHash('sha256').update('PRIVATE_RAW_OUTCOME_FIXTURE').digest('hex') } }
  }
  function outcomeScan(at: string, assessment: 'fail' | 'pass' = 'fail') {
    return buildScanEvidence({ requestedUrl: 'https://outcomes.example/', evaluatedUrl: 'https://outcomes.example/',
      industry: 'general_b2b', region: 'HK', sitemapSource: 'fetched', collectedAt: at,
      checks: Object.fromEntries(Object.keys(CHECK_VERSIONS).map(key => [key, { assessment, collection: 'complete' }])),
      observations: [{ check: 'page', observedAt: at, collection: 'complete', httpStatus: 200,
        target: { origin: 'https://outcomes.example', pathRedacted: false, queryRedacted: false, fragmentRedacted: false, originNormalized: false } }] })
  }
  async function retainedScan(envelope: unknown, at: string, targetClient = client, targetAccount = account, id = randomUUID()) {
    await owner`insert into scans (id,account_id,client_id,url,domain,results,created_at)
      values (${id},${targetAccount},${targetClient},'https://outcomes.example/','outcomes.example',${JSON.stringify({ evidence: envelope })}::jsonb,${at}::timestamptz)`
    return id
  }
  async function retainedPulse(at: string, options: { id?: string; promptId?: string | null; question?: string; platform?: string; targetClient?: string; answer?: string | null } = {}) {
    const id = options.id ?? randomUUID()
    await owner`insert into pulse_metrics (id,client_id,prompt_id,question,platform,scan_week,raw_answer,brand_mentioned,created_at)
      values (${id},${options.targetClient ?? client},${options.promptId ?? null},${options.question ?? 'Stored outcome question?'},${options.platform ?? 'chatgpt'},
        date_trunc('week',${at}::timestamptz at time zone 'UTC')::date,${options.answer === undefined ? 'PRIVATE_RAW_OUTCOME_FIXTURE' : options.answer},false,${at}::timestamptz)`
    return id
  }
  async function outcomeFixture(sourceFactory?: SourceFactory) {
    const [times] = await owner`select
      to_char((statement_timestamp()-interval '20 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') baseline,
      to_char((statement_timestamp()-interval '19 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') submitted,
      to_char((statement_timestamp()-interval '18 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') approved,
      to_char((statement_timestamp()-interval '17 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') delivered,
      to_char((statement_timestamp()-interval '16 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') recorded,
      to_char((statement_timestamp()-interval '9 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') observed`
    const clock = times as OutcomeClock, scanId = randomUUID(), prompt = randomUUID(), otherPrompt = randomUUID()
    await owner`insert into prompt_bank (id,client_id,question) values (${prompt},${client},'Stored outcome question?'),(${otherPrompt},${client},'Stored outcome question?')`
    const envelope = outcomeScan(clock.baseline), source = { kind: 'scan-check' as const, scanId, recordedAt: clock.baseline, envelope }
    const suggestion = deriveSuggestions(source).find(candidate => candidate.source.checkKey === 'c1_robots')
    if (!suggestion) throw new Error('Expected genuine retained scan suggestion')
    const scan = buildInitialDraftSnapshot(suggestion, source, 'en'), pulse = pulseSnapshot(clock.baseline)
    const sources = sourceFactory ? sourceFactory({ scan, pulse, clock, prompt, otherPrompt }) : [scan, pulse, structuredClone(scan)]
    await retainedScan(envelope, clock.baseline, client, account, scanId)
    const pulseSources = new Map(sources.filter(snapshot => snapshot.evidence.kind === 'pulse-metric').map(snapshot => [snapshot.source.id, snapshot]))
    // A malformed frozen calendar test still seeds legal raw timestamptz data.
    for (const snapshot of pulseSources.values()) if (snapshot.evidence.kind === 'pulse-metric') {
      await retainedPulse(clock.baseline, { id: snapshot.evidence.id, question: snapshot.evidence.question, platform: snapshot.evidence.platform, promptId: snapshot.evidence.promptId })
    }
    item = randomUUID()
    const value = { ...draft(), id: item, clientId: client, evidenceSnapshot: pulse }
    await owner`insert into evidence_work_items (id,account_id,client_id,opportunity_key,source_kind,source_id,rule_version,evidence_fingerprint,evidence_snapshot,title,action,notes,locale,created_at)
      values (${item},${account},${client},${randomUUID()},'pulse-metric',${pulse.source.id},'pulse-brand-absent.v1',${'a'.repeat(64)},${JSON.stringify(pulse)}::jsonb,${value.title},${value.action},${value.notes},'en',${clock.baseline}::timestamptz)`
    // A historical frozen package may retain duplicate snapshots. Live source
    // uniqueness remains enforced: only distinct sources are attached here.
    const live = new Map(sources.map(snapshot => [snapshot.source.kind + ':' + snapshot.source.id, snapshot]))
    for (const snapshot of live.values()) await owner`insert into work_item_sources
      (account_id,client_id,work_item_id,opportunity_key,source_kind,source_id,rule_version,check_key,evidence_fingerprint,evidence_snapshot,attached_by)
      values (${account},${client},${item},${randomUUID()},${snapshot.source.kind},${snapshot.source.id},${snapshot.ruleVersion},${snapshot.source.checkKey ?? null},${'a'.repeat(64)},${JSON.stringify(snapshot)}::jsonb,${author})`
    const created = await createVersion(1, 'approved', clock.approved, item, sources, clock.submitted)
    version = created.version; hash = created.hash; approval = created.approval; deliveredAt = clock.delivered
    const eventId = randomUUID()
    await app`insert into work_item_delivery_events
      (id,account_id,client_id,work_item_id,version_id,content_hash,approval_decision_id,approval_decision,kind,actor_id,actor,request_id,recorded_at,destination,delivered_at,note)
      values (${eventId},${account},${client},${item},${version},${hash},${approval},'approved','attest',${author},${JSON.stringify(actor(author))}::jsonb,${randomUUID()},${clock.recorded}::timestamptz,'Historical sample CMS',${clock.delivered}::timestamptz,'Historical self report')`
    return { clock, sources, eventId, prompt, otherPrompt, scope: deliveryScope() }
  }

  async function observeOutcome(scope = deliveryScope()) {
    const envelopes: OutcomeRows[] = []
    // This observer forwards the exact real app result. It neither creates nor
    // edits envelopes and is deliberately separate from projector/evaluator assertions.
    const observing = ((strings: TemplateStringsArray, ...params: unknown[]) => app(strings, ...params).then(rows => {
      envelopes.push(...structuredClone(rows) as OutcomeRows[])
      return rows
    })) as unknown as NeonQueryFunction<false, false>
    storeConnection.sql = observing
    try {
      const result = await readOutcomeInput(scope)
      expect(envelopes).toHaveLength(1)
      return { result, raw: envelopes[0] }
    } finally { storeConnection.sql = app }
  }
  async function readMultiOutcome(scope = deliveryScope()) {
    const { result, raw } = await observeOutcome(scope)
    if (result.kind !== 'ok' || !('schemaVersion' in result.value) || result.value.schemaVersion !== 2) throw new Error('Expected actual V2 SQL projection')
    const input: MultiSourceOutcomeInput = result.value
    const response = parseMultiSourceOutcomeResponse(evaluateMultiSourceOutcomes(input), multiSourceOutcomeContext(input))
    return { input, response, raw }
  }
  async function bulkCandidates(kind: 'scan' | 'pulse', count: number, at: string, question = 'Stored outcome question?', promptId: string | null = null) {
    if (kind === 'scan') await owner`insert into scans (account_id,client_id,url,domain,results,created_at)
      select ${account}::uuid,${client}::uuid,'https://outcomes.example/','outcomes.example',${JSON.stringify({ evidence: outcomeScan(at, 'pass') })}::jsonb,${at}::timestamptz
      from generate_series(1,${count}::int)`
    else await owner`insert into pulse_metrics (client_id,prompt_id,question,platform,scan_week,raw_answer,brand_mentioned,created_at)
      select ${client}::uuid,${promptId}::uuid,${question},'chatgpt',date_trunc('week',${at}::timestamptz at time zone 'UTC')::date,'PRIVATE_RAW_OUTCOME_FIXTURE',false,${at}::timestamptz
      from generate_series(1,${count}::int)`
  }
  async function outcomeWriteCounts() {
    const [counts] = await app`select
      (select count(*)::int from evidence_work_items where account_id=${account} and client_id=${client} and id=${item}) drafts,
      (select count(*)::int from work_item_sources where account_id=${account} and client_id=${client} and work_item_id=${item}) sources,
      (select count(*)::int from work_item_versions where account_id=${account} and client_id=${client} and work_item_id=${item}) versions,
      (select count(*)::int from work_item_decisions where account_id=${account} and client_id=${client} and work_item_id=${item}) decisions,
      (select count(*)::int from work_item_delivery_events where account_id=${account} and client_id=${client} and work_item_id=${item}) delivery,
      (select count(*)::int from work_item_export_events where account_id=${account} and client_id=${client} and work_item_id=${item}) exports`
    return counts
  }

  it('actual outcome SQL preserves V1 and genuine frozen V2 mixed/duplicate identities under one statement clock', async () => {
    const legacy = await readOutcomeInput(deliveryScope())
    if (legacy.kind !== 'ok' || 'schemaVersion' in legacy.value) throw new Error('Expected unchanged V1 input')
    expect(parseOutcomeResponse(evaluateOutcomes(legacy.value)).schemaVersion).toBe(1)
    const fixture = await outcomeFixture(), retained = await readDeliveryVersion(fixture.scope)
    if (!('value' in retained) || retained.value.schemaVersion !== 2) throw new Error('Expected actual retained V2 package')
    const { input, response, raw } = await readMultiOutcome(fixture.scope)
    expect(retained.value.evidenceSnapshots).toEqual(fixture.sources)
    expect(response.contentHash).toBe(retained.value.contentHash)
    expect(response.sources.map(source => source.sourceIndex)).toEqual([0, 1, 2])
    expect(response.sources.map(source => source.baseline?.source.id)).toEqual(fixture.sources.map(source => source.source.id))
    expect(response.sources[0].baseline).toEqual(response.sources[2].baseline)
    expect(response.evaluatedAt).toBe(raw.evaluated_at)
    expect(response.evaluatedAt).toMatch(/\.\d{6}Z$/)
    expect(response.anchor?.id).toBe(fixture.eventId)
    expect(input.sources.every(source => source.sourceState === 'ok')).toBe(true)
    expect(JSON.stringify(response)).not.toMatch(/PRIVATE_RAW_OUTCOME_FIXTURE|raw_answer|envelope|account_id/)
  })

  it('actual matured scan outcomes keep frozen baselines after mutable evidence changes and never rank Pulse success', async () => {
    const fixture = await outcomeFixture(), selectedId = await retainedScan(outcomeScan(fixture.clock.observed, 'pass'), fixture.clock.observed)
    await retainedPulse(fixture.clock.observed)
    const before = await readMultiOutcome()
    const window = before.response.sources[0].windows.find(value => value.day === 7)!
    expect(window).toMatchObject({ evidenceState: 'available', provisional: false, selected: { source: { id: selectedId } },
      comparison: { status: 'partially_comparable', outcome: 'improved', baselineVerdict: 'fail', observedVerdict: 'pass' } })
    expect(before.response.sources[0].windows.filter(value => value.day !== 7).map(value => value.timeState)).toEqual(['not-due', 'not-due'])
    for (const value of before.response.sources[1].windows) expect(value.comparison).toMatchObject({ status: 'not_comparable', outcome: 'cannot_determine' })
    const changed = pulseSnapshot(fixture.clock.observed)
    await owner`update evidence_work_items set evidence_snapshot=${JSON.stringify(changed)}::jsonb,source_id=${changed.source.id},revision=2
      where account_id=${account} and client_id=${client} and id=${item}`
    await owner`update work_item_sources set withdrawn_at=clock_timestamp(),withdrawn_by=${author}
      where account_id=${account} and client_id=${client} and work_item_id=${item} and source_kind='scan-check'`
    const after = await readMultiOutcome()
    expect(after.response.sources.map(source => source.baseline)).toEqual(before.response.sources.map(source => source.baseline))
    expect(after.response.sources[0].windows[0].selected?.source.id).toBe(selectedId)
    expect(after.response.contentHash).toBe(before.response.contentHash)
  })

  it('actual outcome SQL excludes matching foreign-account and sibling-client rows and denies crossed scopes', async () => {
    const fixture = await outcomeFixture(), sibling = randomUUID(), foreign = randomUUID()
    // A live Pro trial legitimately permits the original and sibling brands; keep the quota trigger active.
    await owner`update accounts set plan='pro',status='trialing',trial_ends_at=clock_timestamp()+interval '7 days' where id=${account}`
    await owner`insert into clients (id,account_id,brand_name) values (${sibling},${account},'Sibling fixture'),(${foreign},${otherAccount},'Foreign fixture')`
    const forbidden = [await retainedScan(outcomeScan(fixture.clock.observed, 'pass'), fixture.clock.observed, sibling),
      await retainedScan(outcomeScan(fixture.clock.observed, 'pass'), fixture.clock.observed, foreign, otherAccount),
      await retainedPulse(fixture.clock.observed, { targetClient: sibling }), await retainedPulse(fixture.clock.observed, { targetClient: foreign })]
    const valid = await retainedScan(outcomeScan(fixture.clock.observed, 'pass'), fixture.clock.observed)
    const { raw, response } = await readMultiOutcome()
    const ids = [...raw.scans, ...raw.pulse].map(row => row.id)
    for (const id of forbidden) { expect(ids).not.toContain(id); expect(JSON.stringify(response)).not.toContain(id) }
    expect(response.sources[0].windows[0].selected?.source.id).toBe(valid)
    expect((await readOutcomeInput({ ...fixture.scope, accountId: otherAccount })).kind).toBe('denied')
    expect((await readOutcomeInput({ ...fixture.scope, actorId: randomUUID() })).kind).toBe('denied')
    for (const patch of [{ clientId: sibling }, { clientId: foreign }, { itemId: randomUUID() }, { versionId: randomUUID() }]) {
      expect((await readOutcomeInput({ ...fixture.scope, ...patch })).kind).toBe('not_found')
    }
  })

  it('actual Pulse union filters question/platform/prompt before LIMIT and deduplicates wildcard/exact overlaps', async () => {
    const fixture = await outcomeFixture(({ scan, pulse, clock, prompt }) => [scan, pulse,
      pulseSnapshot(clock.baseline, { promptId: prompt }), pulseSnapshot(clock.baseline, { question: 'Second stored question?' }), structuredClone(pulse)])
    await bulkCandidates('pulse', 205, new Date(Date.parse(fixture.clock.observed) + 1000).toISOString(), 'Unrelated newer question?')
    const matching = await retainedPulse(fixture.clock.observed, { promptId: fixture.prompt })
    const otherPrompt = await retainedPulse(fixture.clock.observed, { promptId: fixture.otherPrompt })
    const second = await retainedPulse(fixture.clock.observed, { question: 'Second stored question?' })
    const wrongPlatform = await retainedPulse(fixture.clock.observed, { platform: 'gemini' })
    const { input, raw } = await readMultiOutcome()
    expect(raw.pulse).toHaveLength(6)
    expect(new Set(raw.pulse.map(row => row.id)).size).toBe(raw.pulse.length)
    expect(raw.pulse.map(row => row.id)).toEqual(expect.arrayContaining([matching, otherPrompt, second]))
    expect(raw.pulse.map(row => row.id)).not.toContain(wrongPlatform)
    expect(raw.pulse.every(row => row.question !== 'Unrelated newer question?')).toBe(true)
    const candidates = input.sources.map(source => source.candidates.map(candidate => candidate.source.id))
    expect(candidates[1]).toEqual(expect.arrayContaining([matching, otherPrompt]))
    expect(candidates[2]).toContain(matching); expect(candidates[2]).not.toContain(otherPrompt); expect(candidates[2]).not.toContain(second)
    expect(candidates[3]).toContain(second); expect(candidates[3]).not.toContain(matching)
    expect(candidates[4]).toEqual(candidates[1])
  })

  it('actual many-source SQL returns at most 201 unique raw rows per kind rather than per source', async () => {
    const fixture = await outcomeFixture(({ scan, pulse, clock, prompt }) => [scan, pulse, structuredClone(scan), structuredClone(pulse),
      pulseSnapshot(clock.baseline, { promptId: prompt }), pulseSnapshot(clock.baseline, { question: 'Starved stored question?' }),
      structuredClone(scan), structuredClone(pulse), structuredClone(scan)])
    await bulkCandidates('scan', 205, fixture.clock.observed)
    await bulkCandidates('pulse', 205, fixture.clock.observed)
    const { input, raw, response } = await readMultiOutcome()
    for (const rows of [raw.scans, raw.pulse]) { expect(rows).toHaveLength(201); expect(new Set(rows.map(row => row.id)).size).toBe(201) }
    for (const source of input.sources) { expect(source.candidates.length).toBeLessThanOrEqual(200); expect(source.truncated).toBe(true) }
    expect(input.sources[5].candidates).toEqual([])
    for (const source of response.sources) {
      expect(source.reasons).toContain('candidate-limit-exceeded')
      expect(source.windows.every(window => window.evidenceState === 'evidence-limited' && window.selected === null)).toBe(true)
    }
    const second = await readMultiOutcome()
    expect(second.raw.scans.map(row => row.id)).toEqual(raw.scans.map(row => row.id))
    expect(second.raw.pulse.map(row => row.id)).toEqual(raw.pulse.map(row => row.id))
  })

  it('actual exactly-200 SQL rows do not claim overflow for either kind', async () => {
    const fixture = await outcomeFixture()
    await bulkCandidates('scan', 199, fixture.clock.observed)
    await bulkCandidates('pulse', 199, fixture.clock.observed)
    const { raw, input, response } = await readMultiOutcome()
    expect(raw.scans).toHaveLength(200); expect(raw.pulse).toHaveLength(200)
    expect(input.sources.every(source => !source.truncated)).toBe(true)
    for (const source of response.sources) expect(source.reasons).not.toContain('candidate-limit-exceeded')
    expect(response.sources[0].windows[0].selected).not.toBeNull()
  })

  it('actual legal malformed observation JSON isolates Scan unavailability without hiding valid Pulse subjects', async () => {
    const fixture = await outcomeFixture()
    const bad = await retainedScan({ collectedAt: 'not-a-calendar', PRIVATE_OBSERVATION: 'must not leak' }, fixture.clock.observed)
    await retainedScan({ ...outcomeScan(fixture.clock.observed), collectedAt: '2026-02-30T00:00:00.000000Z' }, fixture.clock.observed)
    const good = await retainedPulse(fixture.clock.observed)
    const { input, response, raw } = await readMultiOutcome()
    expect(raw.scans.map(row => row.id)).toContain(bad)
    expect(input.sources.map(source => source.sourceState)).toEqual(['unavailable', 'ok', 'unavailable'])
    expect(input.sources[1].candidates.map(candidate => candidate.source.id)).toContain(good)
    for (const index of [0, 2]) expect(response.sources[index].windows.every(window => window.evidenceState === 'unavailable' && window.selected === null)).toBe(true)
    expect(response.sources[1].reasons).not.toContain('source-unavailable')
    expect(response.sources[1].windows.every(window => window.comparison.outcome === 'cannot_determine')).toBe(true)
    expect(JSON.stringify(response)).not.toMatch(/PRIVATE_OBSERVATION|must not leak|PRIVATE_RAW_OUTCOME_FIXTURE/)
  })

  it('actual outcome read retains full 203-event history and the exact historical-version anchor after supersession', async () => {
    const fixture = await outcomeFixture()
    const records: { id: string; request_id: string; recorded_at: string; kind: 'attest' | 'withdraw'; target: string | null }[] = []
    let active = fixture.eventId
    for (let index = 0; index < 101; index++) {
      const recordedAt = new Date(Date.parse(fixture.clock.recorded) + (index + 1) * 1000).toISOString(), next = randomUUID()
      records.push({ id: randomUUID(), request_id: randomUUID(), recorded_at: recordedAt, kind: 'withdraw', target: active },
        { id: next, request_id: randomUUID(), recorded_at: recordedAt, kind: 'attest', target: null })
      active = next
    }
    await app`insert into work_item_delivery_events
      (id,account_id,client_id,work_item_id,version_id,content_hash,approval_decision_id,approval_decision,kind,actor_id,actor,request_id,recorded_at,destination,delivered_at,note,target_attestation_id,target_kind,reason)
      select r.id,${account}::uuid,${client}::uuid,${item}::uuid,${version}::uuid,${hash},
        case when r.kind='attest' then ${approval}::uuid else null end,case when r.kind='attest' then 'approved' else null end,
        r.kind,${author}::uuid,${JSON.stringify(actor(author))}::jsonb,r.request_id,r.recorded_at,
        case when r.kind='attest' then 'Corrected historical CMS' else null end,case when r.kind='attest' then ${fixture.clock.delivered}::timestamptz else null end,
        case when r.kind='attest' then 'Historical self report' else null end,r.target,case when r.kind='withdraw' then 'attest' else null end,
        case when r.kind='withdraw' then 'Historical correction' else null end
      from jsonb_to_recordset(${JSON.stringify(records)}::jsonb) r(id uuid,request_id uuid,recorded_at timestamptz,kind text,target uuid)`
    const retained = await readMultiOutcome()
    expect(retained.raw.events).toHaveLength(203)
    expect(retained.response.anchor?.id).toBe(active)
    await prepareNextDraft(); await createVersion(2, 'approved', null, item, fixture.sources)
    const historical = await readMultiOutcome(fixture.scope)
    expect(historical.response.versionId).toBe(fixture.scope.versionId)
    expect(historical.response.contentHash).toBe(hash)
    expect(historical.response.anchor?.id).toBe(active)
    expect((await readDelivery(fixture.scope, { limit: 1, cursor: null }))).toMatchObject({ value: { activeAttestationId: active } })
    expect((await withdrawDelivery(fixture.scope, active, { reason: 'Withdraw historical declaration', requestId: randomUUID() })).kind).toBe('created')
    const withdrawn = await readMultiOutcome(fixture.scope)
    expect(withdrawn.response.anchorState).toBe('withdrawn'); expect(withdrawn.response.anchor).toBeNull()
    expect(withdrawn.response.sources.every(source => source.windows.length === 0 && source.reasons.includes('anchor-withdrawn'))).toBe(true)
  })

  it('actual canonical V2 content with an invalid frozen calendar fails the whole read', async () => {
    const fixture = await outcomeFixture(({ scan, pulse }) => {
      if (pulse.evidence.kind !== 'pulse-metric') throw new Error('Expected Pulse fixture')
      return [scan, { ...pulse, evidence: { ...pulse.evidence, recordedAt: '2026-02-30T00:00:00.000000Z' } }, structuredClone(scan)]
    })
    // The Node freezer and SQL constraints admitted normalized string JSON; the
    // stored-outcome primary calendar adapter must independently refuse it.
    const retained = await readDeliveryVersion(fixture.scope)
    expect(retained.kind).toBe('replayed')
    expect((await observeOutcome(fixture.scope)).result).toEqual({ kind: 'unavailable' })
  })

  it('actual stored V2 hash/content mismatch is unavailable rather than a partial-source success', async () => {
    const fixture = await outcomeFixture(), corrupted = randomUUID(), frozen = freezeMultiSourceReview({ ...draft(), id: item, revision: 2 }, fixture.sources)
    const wrongHash = frozen.contentHash === 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64)
    await owner`insert into work_item_versions (id,account_id,client_id,work_item_id,version_number,draft_revision,content,content_hash,validation,submitter)
      values (${corrupted},${account},${client},${item},2,2,${JSON.stringify(frozen.content)}::jsonb,${wrongHash},${JSON.stringify(frozen.validation)}::jsonb,${JSON.stringify(actor(author))}::jsonb)`
    expect((await observeOutcome({ ...fixture.scope, versionId: corrupted })).result).toEqual({ kind: 'unavailable' })
    expect((await readMultiOutcome(fixture.scope)).response.contentHash).toBe(hash)
  })

  it('actual V2 diagnostic occurrences share one round-robin 400 budget and repeated reads create no business receipts', async () => {
    const fixture = await outcomeFixture(({ scan, pulse }) => [scan, pulse, structuredClone(pulse), structuredClone(pulse)])
    await bulkCandidates('pulse', 199, fixture.clock.observed)
    const selected = await retainedScan(outcomeScan(fixture.clock.observed, 'pass'), fixture.clock.observed), counts = await outcomeWriteCounts()
    let retainedDiagnostics: string[][] | undefined
    for (let attempt = 0; attempt < 3; attempt++) {
      const { response, raw } = await readMultiOutcome()
      expect(raw.pulse).toHaveLength(200)
      expect(response.sources.reduce((total, source) => total + source.diagnostics.length, 0)).toBe(400)
      expect(response.sources.map(source => source.diagnostics.length)).toEqual([0, 134, 133, 133])
      expect(response.sources[0].windows[0].selected?.source.id).toBe(selected)
      expect(response.sources[0].reasons).not.toContain('diagnostic-limit-exceeded')
      for (const source of response.sources.slice(1)) {
        expect(source.reasons).toContain('diagnostic-limit-exceeded')
        expect(source.reasons).not.toContain('candidate-limit-exceeded')
        expect(source.windows.every(window => window.evidenceState === 'evidence-limited' && window.selected === null)).toBe(true)
      }
      const ids = response.sources.map(source => source.diagnostics.map(row => row.source.id))
      if (retainedDiagnostics) expect(ids).toEqual(retainedDiagnostics)
      retainedDiagnostics = ids
    }
    expect(await outcomeWriteCounts()).toEqual(counts)
    expect(fixture.sources).toHaveLength(4)
  })
})
