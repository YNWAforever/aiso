import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll,afterAll,beforeEach,describe,expect,it } from 'vitest'
let pg:PGlite
const a='11000000-0000-4000-8000-000000000001',b='11000000-0000-4000-8000-000000000002',p='22000000-0000-4000-8000-000000000001',admin='22000000-0000-4000-8000-000000000002',foreign='22000000-0000-4000-8000-000000000003',c='33000000-0000-4000-8000-000000000001',key='44000000-0000-4000-8000-000000000001',request='55000000-0000-4000-8000-000000000001'
beforeAll(async()=>{pg=await PGlite.create();await pg.exec(`create role aeo_app;create table accounts(id uuid primary key,plan text default 'enterprise',status text default 'active',stripe_subscription_id text default 'fixture',trial_ends_at timestamptz,override_plan text,override_expires_at timestamptz);create table profiles(id uuid primary key,account_id uuid references accounts(id),display_name text,is_admin boolean default false,deactivated_at timestamptz,unique(id,account_id));create table clients(id uuid primary key,account_id uuid references accounts(id),unique(id,account_id));`);await pg.exec('alter default privileges in schema public grant select,insert,update,delete on tables to aeo_app;');await pg.exec(readFileSync('supabase/migrations/076_enterprise_access.sql','utf8'));await pg.exec(readFileSync('supabase/migrations/079_enterprise_role_delegation.sql','utf8'))})
afterAll(async()=>pg?.close())
beforeEach(async()=>{await pg.exec('truncate accounts cascade');await pg.query('insert into accounts(id) values($1),($2)',[a,b]);await pg.query('insert into profiles(id,account_id,is_admin) values($1,$2,false),($3,$2,true),($4,$5,false)',[p,a,admin,foreign,b]);await pg.query('insert into clients values($1,$2)',[c,a])})
const grant=(actor=admin,target=p,revision=0,role='manager',id=request)=>pg.query<{result:string}>('select enterprise_set_role($1,$2,$3,$4,$5,$6,$7) as result',[a,actor,target,role,revision,id,'Approved role change'])
describe('actual enterprise access SQL',()=>{
 it('requires a live platform admin, owned target and exact revision; grants are replay-safe',async()=>{
  expect((await grant(p)).rows[0].result).toBe('DENIED');expect((await grant(admin,foreign)).rows[0].result).toBe('NOT_FOUND')
  expect((await grant()).rows[0].result).toBe('CREATED');expect((await grant()).rows[0].result).toBe('REPLAYED')
  expect((await grant(admin,p,0,'editor')).rows[0].result).toBe('CONFLICT')
  expect((await pg.query('select enterprise_member_role($1,$2) as role',[a,p])).rows).toEqual([{role:'manager'}])
  expect((await pg.query('select * from enterprise_role_events')).rows).toHaveLength(1)
  await pg.query('update profiles set deactivated_at=now() where id=$1',[admin]);expect((await grant(admin,p,1,'editor','55000000-0000-4000-8000-000000000002')).rows[0].result).toBe('DENIED')
 })
 it('denies foreign/deactivated identities and cannot promote through a corrupted lineage',async()=>{
  expect((await pg.query('select enterprise_member_role($1,$2) as role',[a,foreign])).rows).toEqual([{role:null}])
  await grant();await pg.query('update profiles set deactivated_at=now() where id=$1',[p]);expect((await pg.query('select enterprise_member_role($1,$2) as role',[a,p])).rows).toEqual([{role:null}])
 })
 it('atomically fences signed-request replay and per-key allowance and stops revoked issuers',async()=>{
  await grant();await pg.query("insert into enterprise_keys(id,account_id,client_id,created_by,name,scopes,ciphertext,key_id) values($1,$2,$3,$4,'Fixture',array['outcomes:read'],decode('abcd','hex'),'test')",[key,a,c,p])
  const consume=(nonce:string,account=a)=>pg.query<{result:string}>('select enterprise_consume_request($1,$2,$3,$4,$5) as result',[account,c,key,nonce,'outcomes:read'])
  expect((await consume(request,b)).rows[0].result).toBe('DENIED')
  expect((await consume(request)).rows[0].result).toBe('OK');expect((await consume(request)).rows[0].result).toBe('REPLAY')
  for(let i=2;i<=60;i++)expect((await consume(`55000000-0000-4000-8000-${String(i).padStart(12,'0')}`)).rows[0].result).toBe('OK')
  expect((await consume('55000000-0000-4000-8000-000000000061')).rows[0].result).toBe('RATE_LIMITED')
  await pg.query('update enterprise_keys set revoked_at=now() where id=$1',[key]);expect((await consume('55000000-0000-4000-8000-000000000062')).rows[0].result).toBe('DENIED')
 })
})

describe('SQL and catalogue entitlement parity',()=>{
 it.each([
  {plan:'enterprise',status:'active',stripe_subscription_id:'fixture'},
  {plan:'enterprise',status:'cancelled',stripe_subscription_id:'fixture'},
  {plan:'enterprise',status:'trialing',stripe_subscription_id:'fixture'},
  {plan:'enterprise',status:'active',stripe_subscription_id:null,trial_ends_at:'2090-01-01T00:00:00Z'},
  {plan:'enterprise',status:'past_due',override_plan:'enterprise',override_expires_at:null},
  {plan:'enterprise',status:'active',stripe_subscription_id:'fixture',override_plan:'free',override_expires_at:null},
  {plan:'pro',status:'active',stripe_subscription_id:'fixture',override_plan:'enterprise',override_expires_at:'infinity'},
 ])('matches the shared resolver for %j',async account=>{
  const {resolveCommercialEntitlement}=await import('@/lib/tier')
  const input={stripe_subscription_id:null,trial_ends_at:null,override_plan:null,override_expires_at:null,...account}
  await pg.query('update accounts set plan=$1,status=$2,stripe_subscription_id=$3,trial_ends_at=$4,override_plan=$5,override_expires_at=$6 where id=$7',[input.plan,input.status,input.stripe_subscription_id,input.trial_ends_at,input.override_plan,input.override_expires_at,a])
  expect((await pg.query('select enterprise_account_entitled($1) as allowed',[a])).rows).toEqual([{allowed:resolveCommercialEntitlement(input).features.enterprise_workflows}])
 })
})
