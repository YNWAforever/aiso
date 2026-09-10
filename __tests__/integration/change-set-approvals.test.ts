import { randomUUID } from 'node:crypto'
import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { assertApprovedTarget } from './approved-target'
import { freezeReview } from '@/lib/change-sets/validation'
import type { WorkItem } from '@/lib/work-items/schema'
vi.mock('server-only', () => ({}))

// AUTHORED ONLY. Separate approval must provision the exact disposable target,
// apply 042, and install aeo_app first. Never auto-provision or auto-migrate.
// Retained immutable rows are intentional; dispose of the approved branch separately.
const project = process.env.C9D_DISPOSABLE_PROJECT_ID
const branch = process.env.C9D_DISPOSABLE_BRANCH_ID
const databaseUrl = process.env.C9D_TEST_DATABASE_URL
const protectedBranches = new Set(['br-square-mountain-az6f82vi', process.env.NEON_TEST_PRODUCTION_BRANCH_ID].filter(Boolean))
const optedIn = Boolean(project || branch || databaseUrl)

it('refuses to report success without an approved disposable target', () => assertApprovedTarget(optedIn, 'C9D_DISPOSABLE_PROJECT_ID, C9D_DISPOSABLE_BRANCH_ID and C9D_TEST_DATABASE_URL'))

describe.skipIf(!optedIn)('change-set schema on an exact disposable target', () => {
  let sql: NeonQueryFunction<false, false>
  const account = randomUUID(), otherAccount = randomUUID(), client = randomUUID()
  const author = randomUUID(), reviewer = randomUUID(), admin = randomUUID(), workItemId = randomUUID()
  const grantEvent = randomUUID()
  let revision = 0
  const actor = (profileId: string, role: string) => JSON.stringify({profileId, displayName:'Fixture actor', role})
  const evidenceSnapshot: WorkItem['evidenceSnapshot'] = {
    schemaVersion:1, source:{kind:'pulse-metric',id:'123e4567-e89b-42d3-a456-426614174000'}, ruleVersion:'pulse-brand-absent.v1',
    evidence:{kind:'pulse-metric',id:'123e4567-e89b-42d3-a456-426614174000',promptId:null,question:'Example?',platform:'chatgpt',scanWeek:'2026-08-31',recordedAt:null,result:'success',hasAnswer:true,brandMentioned:false,answerDigest:'a'.repeat(64),provenance:'retained-pulse-metric',limitations:[]},
    limitations:[],titleKey:'review-question-coverage',actionKey:'review-question-coverage',args:{question:'Example?',platform:'chatgpt'},locale:'en',initialTitle:'Review question coverage',initialAction:'Review the recorded response.',
  }
  const frozen = (draftRevision: number) => freezeReview({id:workItemId,clientId:client,status:'draft',title:'Review question coverage',action:'Review the recorded response.',notes:'',locale:'en',revision:draftRevision,createdAt:'2026-09-06T00:00:00.000Z',updatedAt:'2026-09-06T00:00:00.000Z',evidenceSnapshot})

  beforeAll(async () => {
    if (!project || !branch || !databaseUrl || !/^br-[a-z0-9-]+$/.test(branch) || protectedBranches.has(branch) || /(?:production|staging|main|default)/i.test(branch)) throw new Error('Exact disposable C9d target required')
    const url = new URL(databaseUrl)
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech')) throw new Error('Dedicated Neon test connection required')
    sql = neon(databaseUrl)
    const [identity] = await sql`select current_setting('neon.project_id',true) project, current_setting('neon.branch_id',true) branch, current_user role, to_regrole('aeo_app') is not null app_exists, (select pg_get_userbyid(relowner) = current_user from pg_class where oid='public.work_item_versions'::regclass) owner_capable`
    if (identity.project !== project || identity.branch !== branch || !identity.owner_capable || !identity.app_exists || identity.role === 'aeo_app') throw new Error('Disposable C9d identity or schema mismatch')
    await sql`insert into accounts (id,plan) values (${account},'basic'),(${otherAccount},'basic')`
    await sql`insert into clients (id,account_id,brand_name) values (${client},${account},'C9d fixture')`
    for (const id of [author,reviewer,admin]) {
      await sql`insert into neon_auth.user (id,email,name,"emailVerified") values (${id},${`${id}@example.test`},'Fixture actor',false)`
      await sql`insert into profiles (id,account_id,display_name) values (${id},${account},'Fixture actor')`
    }
    await sql`insert into evidence_work_items (id,account_id,client_id,opportunity_key,source_kind,source_id,rule_version,evidence_fingerprint,evidence_snapshot,title,action,locale) values (${workItemId},${account},${client},${randomUUID()},'pulse-metric',${evidenceSnapshot.source.id},'pulse-brand-absent.v1',${'a'.repeat(64)},${JSON.stringify(evidenceSnapshot)}::jsonb,'Review','Review response','en')`
    await sql.transaction([
      sql`insert into account_approver_events (id,account_id,profile_id,action,previous_revision,new_revision,administrator_id,administrator,reason,request_id) values (${grantEvent},${account},${reviewer},'grant',0,1,${admin},${actor(admin,'platform_admin')}::jsonb,'Initial grant',${randomUUID()})`,
      sql`insert into account_approver_state (account_id,profile_id,active,revision,last_event_id) values (${account},${reviewer},true,1,${grantEvent})`,
    ],{isolationLevel:'ReadCommitted'})
  })

  const insertVersion = (options: {accountId?:string; content?:unknown; validation?:unknown; submitter?:unknown; hash?:string} = {}) => {
    const n = ++revision, review = frozen(n), id = randomUUID()
    return {id,hash:review.contentHash,query:sql`insert into work_item_versions (id,account_id,client_id,work_item_id,version_number,draft_revision,content,content_hash,validation,submitter) values (${id},${options.accountId ?? account},${client},${workItemId},${n},${n},${JSON.stringify(options.content === undefined ? review.content : options.content)}::jsonb,${options.hash ?? review.contentHash},${JSON.stringify(options.validation === undefined ? review.validation : options.validation)}::jsonb,${JSON.stringify(options.submitter === undefined ? JSON.parse(actor(author,'account_member')) : options.submitter)}::jsonb) returning id`}
  }
  const decision = (versionId: string, hash: string, accountId = account) => sql`insert into work_item_decisions (account_id,client_id,work_item_id,version_id,content_hash,decision,reason,actor_id,actor,grant_revision,grant_event_id,request_id) values (${accountId},${client},${workItemId},${versionId},${hash},'approved','Reviewed evidence',${reviewer},${actor(reviewer,'account_approver')}::jsonb,1,${grantEvent},${randomUUID()}) returning id`

  it('accepts the canonical validator package and atomic initial grant', async () => {
    expect(await insertVersion().query).toHaveLength(1)
    expect(await sql`select active,revision,last_event_id from account_approver_state where account_id=${account} and profile_id=${reviewer}`).toEqual([{active:true,revision:1,last_event_id:grantEvent}])
  })
  it('rejects wrong-tenant version, decision and altered exact hash', async () => {
    await expect(insertVersion({accountId:otherAccount}).query).rejects.toMatchObject({code:'23503'})
    const version = insertVersion(); await version.query
    await expect(decision(version.id,version.hash,otherAccount)).rejects.toMatchObject({code:'23503'})
    await expect(decision(version.id,'b'.repeat(64))).rejects.toMatchObject({code:'23503'})
  })
  it.each([null,{},[],{schemaVersion:1,evidenceSnapshot:null}])('rejects incomplete or null JSON content %j', async content => {
    await expect(insertVersion({content}).query).rejects.toMatchObject({code:'23514'})
  })
  it.each([null,{}, {policyVersion:null}, {policyVersion:'change-set-review.v2',checks:[]}])('rejects invalid validation %j', async validation => {
    await expect(insertVersion({validation}).query).rejects.toMatchObject({code:'23514'})
  })
  it.each([null,{}, {profileId:null,displayName:null,role:'account_member'}])('rejects invalid submitter %j', async submitter => {
    await expect(insertVersion({submitter}).query).rejects.toMatchObject({code:'23514'})
  })
  it('enforces the evidence byte limit independently of schema and package size', async () => {
    const withEvidencePadding = (length: number) => {
      const content = frozen(revision+1).content
      return {...content,evidenceSnapshot:{...content.evidenceSnapshot,padding:'x'.repeat(length)}}
    }
    const sizes = async (content: unknown) => {
      const [row] = await sql`select octet_length((${JSON.stringify(content)}::jsonb->'evidenceSnapshot')::text) evidence_bytes, octet_length(${JSON.stringify(content)}::jsonb::text) content_bytes`
      return row
    }
    const control = withEvidencePadding(63000)
    const controlSizes = await sizes(control)
    expect(controlSizes.evidence_bytes).toBeLessThanOrEqual(65536)
    expect(controlSizes.content_bytes).toBeLessThan(131072)
    expect(await insertVersion({content:control}).query).toHaveLength(1)

    const oversized = withEvidencePadding(65536)
    const oversizedSizes = await sizes(oversized)
    expect(oversizedSizes.evidence_bytes).toBeGreaterThan(65536)
    expect(oversizedSizes.content_bytes).toBeLessThan(131072)
    // 042 names the combined content CHECK; the valid control and byte assertions
    // isolate its evidence-size clause without changing the production schema.
    await expect(insertVersion({content:oversized}).query).rejects.toMatchObject({code:'23514',constraint:'work_item_versions_content_check'})
  })
  it('enforces the overall package byte limit with valid evidence', async () => {
    const content = {...frozen(revision+1).content,extra:'x'.repeat(131072)}
    await expect(insertVersion({content}).query).rejects.toMatchObject({code:'23514',constraint:'work_item_versions_content_check'})
  })
  it('has immutable role grants, including no truncate or inherited public writes', async () => {
    for (const table of ['work_item_versions','work_item_decisions','account_approver_events','account_approver_state']) {
      const [grants] = await sql`select has_table_privilege('aeo_app',${`public.${table}`},'SELECT') r, has_table_privilege('aeo_app',${`public.${table}`},'INSERT') i, has_table_privilege('aeo_app',${`public.${table}`},'UPDATE') u, has_table_privilege('aeo_app',${`public.${table}`},'DELETE') d, has_table_privilege('aeo_app',${`public.${table}`},'TRUNCATE') t`
      expect(grants).toEqual({r:true,i:true,u:table==='account_approver_state',d:false,t:false})
    }
    await expect(sql.transaction([sql`set local role aeo_app`,sql`update work_item_versions set content_hash=${'c'.repeat(64)} where account_id=${account}`])).rejects.toMatchObject({code:'42501'})
  })
  it('rolls back both audit and access state when the audit is invalid', async () => {
    const eventId=randomUUID()
    await expect(sql.transaction([
      sql`update account_approver_state set active=false,revision=2,last_event_id=${eventId} where account_id=${account} and profile_id=${reviewer}`,
      sql`insert into account_approver_events (id,account_id,profile_id,action,previous_revision,new_revision,administrator_id,administrator,reason,request_id) values (${eventId},${account},${reviewer},'revoke',1,2,${admin},${actor(admin,'platform_admin')}::jsonb,'',${randomUUID()})`,
    ])).rejects.toMatchObject({code:'23514'})
    expect(await sql`select active,revision from account_approver_state where account_id=${account} and profile_id=${reviewer}`).toEqual([{active:true,revision:1}])
    expect(await sql`select id from account_approver_events where account_id=${account} and id=${eventId}`).toHaveLength(0)
  })
  it('rejects a state revision without its exact event at commit', async () => {
    await expect(sql`update account_approver_state set revision=2,last_event_id=${randomUUID()} where account_id=${account} and profile_id=${reviewer}`).rejects.toMatchObject({code:'23503'})
  })
  it('retains exactly one terminal decision under concurrent inserts', async () => {
    const version=insertVersion(); await version.query
    const results=await Promise.allSettled([decision(version.id,version.hash),decision(version.id,version.hash)])
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1)
    expect(results.filter(result=>result.status==='rejected')).toHaveLength(1)
    expect(await sql`select id from work_item_decisions where account_id=${account} and version_id=${version.id}`).toHaveLength(1)
  })
  it('serializes conditional decision and revocation with the shared lock protocol', async () => {
    const version=insertVersion(); await version.query
    const eventId=randomUUID()
    const decide=()=>sql.transaction([
      sql`select id from profiles where account_id=${account} and id in (${author},${reviewer}) order by id for share`,
      sql`select id from evidence_work_items where account_id=${account} and client_id=${client} and id=${workItemId} for update`,
      sql`select profile_id from account_approver_state where account_id=${account} and profile_id=${reviewer} for update`,
      sql`insert into work_item_decisions (account_id,client_id,work_item_id,version_id,content_hash,decision,reason,actor_id,actor,grant_revision,grant_event_id,request_id) select ${account},${client},${workItemId},${version.id},${version.hash},'approved','Race review',${reviewer},${actor(reviewer,'account_approver')}::jsonb,s.revision,s.last_event_id,${randomUUID()} from account_approver_state s where s.account_id=${account} and s.profile_id=${reviewer} and s.active and exists (select 1 from profiles p where p.id=${reviewer} and p.account_id=${account}) on conflict do nothing returning id`,
    ],{isolationLevel:'ReadCommitted'})
    const revoke=()=>sql.transaction([
      // Stronger ordered profile locks also satisfy the production lock ordering.
      sql`select id from profiles where account_id=${account} and id in (${admin},${reviewer}) order by id for update`,
      sql`select profile_id from account_approver_state where account_id=${account} and profile_id=${reviewer} for update`,
      sql`insert into account_approver_events (id,account_id,profile_id,action,previous_revision,new_revision,administrator_id,administrator,reason,request_id) values (${eventId},${account},${reviewer},'revoke',1,2,${admin},${actor(admin,'platform_admin')}::jsonb,'Race revoke',${randomUUID()})`,
      sql`update account_approver_state set active=false,revision=2,last_event_id=${eventId} where account_id=${account} and profile_id=${reviewer}`,
    ],{isolationLevel:'ReadCommitted'})
    const [result]=await Promise.all([decide(),revoke()])
    expect(result[3].length).toBeLessThanOrEqual(1)
    expect((await decide())[3]).toHaveLength(0)
    expect(await sql`select active,revision from account_approver_state where account_id=${account} and profile_id=${reviewer}`).toEqual([{active:false,revision:2}])
  })
  it('preserves frozen actor identities after profiles are deleted and restricts history parents', async () => {
    await sql`delete from profiles where account_id=${account} and id in (${author},${reviewer},${admin})`
    const [version]=await sql`select submitter from work_item_versions where account_id=${account} order by version_number limit 1`
    expect(version.submitter.profileId).toBe(author)
    const [review]=await sql`select actor_id,actor from work_item_decisions where account_id=${account} limit 1`
    expect(review.actor_id).toBe(reviewer); expect(review.actor.profileId).toBe(reviewer)
    const [event]=await sql`select profile_id,administrator_id,administrator from account_approver_events where account_id=${account} and id=${grantEvent}`
    expect(event).toMatchObject({profile_id:reviewer,administrator_id:admin,administrator:{profileId:admin}})
    await expect(sql`delete from evidence_work_items where account_id=${account} and id=${workItemId}`).rejects.toMatchObject({code:'23001'})
    await expect(sql`delete from clients where account_id=${account} and id=${client}`).rejects.toMatchObject({code:'23001'})
    await expect(sql`delete from accounts where id=${account}`).rejects.toMatchObject({code:'23001'})
  })
})
