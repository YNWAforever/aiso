import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll,afterAll,beforeEach,describe,expect,it } from 'vitest'
import { enterpriseFixture,ids as i } from './fixture'
let pg:PGlite
const member='22000000-0000-4000-8000-000000000004',member2='22000000-0000-4000-8000-000000000005'
let sequence=0
const requestId=()=>`55000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`
const change=async(actor:string,target:string,role:string,revision=0,account=i.account,request=requestId())=>(await pg.query<{result:string}>('select enterprise_set_role($1,$2,$3,$4,$5,$6,$7) as result',[account,actor,target,role,revision,request,'Reviewed workspace role change'])).rows[0].result
let legacy:{role:string;authority:unknown;parent:unknown}|null=null
beforeAll(async()=>{
 pg=await enterpriseFixture(false)
 await pg.exec(readFileSync('supabase/migrations/079_enterprise_role_delegation.sql','utf8'))
 const [old]=(await pg.query<{role:string;actor_authority?:string;actor_role_event_id?:string}>('select * from enterprise_role_events where profile_id=$1',[i.manager])).rows
 legacy={role:old.role,authority:old.actor_authority,parent:old.actor_role_event_id}
})
afterAll(async()=>pg?.close())
beforeEach(async()=>{
 sequence=0;await pg.exec('truncate accounts,account_approver_state,account_approver_events cascade')
 await pg.query('insert into accounts(id) values($1),($2)',[i.account,i.foreign])
 await pg.query('insert into profiles(id,account_id,is_admin,display_name) values($1,$2,false,\'Manager\'),($3,$2,true,\'Platform admin\'),($4,$5,false,\'Foreign\'),($6,$2,false,\'Member\'),($7,$2,false,\'Member 2\')',[i.manager,i.account,i.admin,i.outsider,i.foreign,member,member2])
 await pg.query('insert into clients(id,account_id) values($1,$2)',[i.client,i.account])
 await change(i.admin,i.manager,'manager')
})
describe('workspace role delegation SQL',()=>{
 it('preserves existing platform grants when the additive migration is applied',()=>{expect(legacy).toEqual({role:'manager',authority:'platform_admin',parent:null})})
 it('rejects missing or foreign workspace authority lineage rather than accepting nullable FK bypasses',async()=>{
  const [parent]=(await pg.query<{event_id:string}>('select event_id from enterprise_roles where account_id=$1 and profile_id=$2',[i.account,i.manager])).rows
  await expect(pg.query("insert into enterprise_role_events(account_id,profile_id,role,previous_revision,revision,actor_id,actor_authority,actor_role_event_id,request_id,reason) values($1,$2,'editor',0,1,$3,'workspace_manager',$4,$5,'Invalid lineage')",[i.account,member,i.manager,parent.event_id,requestId()])).rejects.toThrow()
  await expect(pg.query("insert into enterprise_role_events(account_id,profile_id,role,previous_revision,revision,actor_id,actor_authority,actor_role_revision,actor_role_event_id,request_id,reason) values($1,$2,'editor',0,1,$3,'workspace_manager',1,$4,$5,'Foreign lineage')",[i.foreign,i.outsider,i.manager,parent.event_id,requestId()])).rejects.toThrow()
 })
 it('allows a workspace Manager to grant and revoke elevated access with immutable authority lineage',async()=>{
  expect(await change(i.manager,member,'editor')).toBe('CREATED')
  const [managerGrant]=(await pg.query<{event_id:string;revision:number}>('select event_id,revision from enterprise_roles where account_id=$1 and profile_id=$2',[i.account,i.manager])).rows
  const [delegated]=(await pg.query('select * from enterprise_role_events where profile_id=$1',[member])).rows
  expect(delegated).toMatchObject({role:'editor',previous_role:'viewer',actor_authority:'workspace_manager',actor_role_event_id:managerGrant.event_id,actor_role_revision:managerGrant.revision})
  expect(await change(i.manager,member,'viewer',1)).toBe('CREATED')
  expect((await pg.query("select action,metadata->>'role' as role from enterprise_audit where actor_id=$1 and target_id=$2 order by (metadata->>'revision')::int,case action when 'role.revoked' then 0 else 1 end",[i.manager,member])).rows).toEqual([{action:'role.granted',role:'editor'},{action:'role.revoked',role:'editor'},{action:'role.granted',role:'viewer'}])
  expect((await pg.query('select role from enterprise_roles where account_id=$1 and profile_id=$2',[i.account,member])).rows).toEqual([{role:'viewer'}])
  await pg.exec('set role aeo_app')
  try{await expect(pg.query("update enterprise_role_events set reason='Rewrite' where profile_id=$1",[member])).rejects.toThrow();await expect(pg.query('delete from enterprise_audit where actor_id=$1',[i.manager])).rejects.toThrow()}finally{await pg.exec('reset role')}
 })
 it.each(['viewer','editor'])('denies non-admin %s escalation with no grant or audit writes',async role=>{
  await change(i.admin,member,role)
  const before=(await pg.query('select count(*)::int as n from enterprise_role_events')).rows
  expect(await change(member,member2,'manager')).toBe('DENIED')
  expect((await pg.query('select count(*)::int as n from enterprise_role_events')).rows).toEqual(before)
 })
 it('denies foreign account and foreign target grants while retaining platform-admin provisioning',async()=>{
  expect(await change(i.manager,i.outsider,'manager',0,i.foreign)).toBe('DENIED')
  expect(await change(i.manager,i.outsider,'manager')).toBe('NOT_FOUND')
  expect(await change(i.admin,i.outsider,'manager',0,i.foreign)).toBe('CREATED')
  expect(await change(i.outsider,member,'manager',0,i.account)).toBe('DENIED')
 })
 it('keeps replays idempotent and rejects conflicting revisions or changed replay payloads',async()=>{
  const request=requestId()
  expect(await change(i.manager,member,'manager',0,i.account,request)).toBe('CREATED')
  expect(await change(i.manager,member,'manager',0,i.account,request)).toBe('REPLAYED')
  expect(await change(i.manager,member,'editor',0,i.account,request)).toBe('CONFLICT')
  expect(await change(i.manager,member,'viewer',0)).toBe('CONFLICT')
  expect((await pg.query('select * from enterprise_role_events where profile_id=$1',[member])).rows).toHaveLength(1)
 })
 it('rechecks delegation authority after a reciprocal demotion instead of trusting stale Manager access',async()=>{
  expect(await change(i.manager,member,'manager')).toBe('CREATED')
  expect(await change(member,i.manager,'viewer',1)).toBe('CREATED')
  expect(await change(i.manager,member,'viewer',1)).toBe('DENIED')
  expect((await pg.query("select profile_id from enterprise_roles where role='manager'")).rows).toEqual([{profile_id:member}])
 })
 it('denies workspace self-role changes while a platform admin can still change their own workspace role',async()=>{
  expect(await change(i.manager,i.manager,'viewer',1)).toBe('SELF_ROLE_CHANGE_DENIED')
  expect(await change(i.admin,i.admin,'manager')).toBe('CREATED')
 })
 it('requires a current Enterprise entitlement even for platform-admin assignments',async()=>{
  await pg.query("update accounts set status='cancelled' where id=$1",[i.account])
  expect(await change(i.manager,member,'manager')).toBe('ENTITLEMENT_REQUIRED')
  expect(await change(i.admin,member,'manager')).toBe('ENTITLEMENT_REQUIRED')
 })
 it('denies inactive issuers and targets and never mints platform or approver authority',async()=>{
  for(const role of ['owner','approver','platform_admin'])expect(await change(i.manager,member,role)).toBe('INVALID')
  await pg.query('update profiles set deactivated_at=now() where id=$1',[member]);expect(await change(i.manager,member,'editor')).toBe('NOT_FOUND')
  await pg.query('update profiles set deactivated_at=now() where id=$1',[i.manager]);expect(await change(i.manager,member2,'editor')).toBe('DENIED')
  expect((await pg.query('select * from account_approver_state')).rows).toHaveLength(0)
  expect((await pg.query('select is_admin from profiles where id=$1',[member2])).rows).toEqual([{is_admin:false}])
 })
 it('executes delegation under aeo_app and preserves author and submitter separation with a live approver grant',async()=>{
  await pg.exec('set role aeo_app')
  try{expect(await change(i.manager,member,'manager')).toBe('CREATED')}finally{await pg.exec('reset role')}
  await pg.query("insert into account_approver_events values($1,$2,$3,1,'grant')",[i.request,i.account,member])
  await pg.query('insert into account_approver_state values($1,$2,1,$3,true)',[i.account,member,i.request])
  for(const [author,submitter]of [[member,i.manager],[i.manager,member]]){
   const [artifact]=(await pg.query<{id:string}>("insert into enterprise_artifacts(account_id,client_id,kind,created_by,submitted_by,payload) values($1,$2,'executive_report',$3,$4,'{}') returning id",[i.account,i.client,author,submitter])).rows
   // The fixture needs an owned client for the immutable artifact chain.
   expect((await pg.query('select enterprise_decide($1,$2,$3,$4,$5,$6,$7) as result',[i.account,i.client,artifact.id,member,'approved','Review reason',requestId()])).rows).toEqual([{result:'DENIED'}])
  }
 })
})
