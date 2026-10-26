import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll,afterAll,describe,expect,it } from 'vitest'
let pg:PGlite
const a='11000000-0000-4000-8000-000000000001',b='11000000-0000-4000-8000-000000000002',editor='22000000-0000-4000-8000-000000000001',reviewer='22000000-0000-4000-8000-000000000002',foreign='22000000-0000-4000-8000-000000000003',c='33000000-0000-4000-8000-000000000001',artifact='44000000-0000-4000-8000-000000000001',event='55000000-0000-4000-8000-000000000001',request='66000000-0000-4000-8000-000000000001'
beforeAll(async()=>{pg=await PGlite.create();await pg.exec(`create role aeo_app;create table accounts(id uuid primary key,plan text default 'enterprise',status text default 'active',stripe_subscription_id text default 'fixture',trial_ends_at timestamptz,override_plan text,override_expires_at timestamptz);create table profiles(id uuid primary key,account_id uuid references accounts(id),display_name text,is_admin boolean default false,deactivated_at timestamptz,unique(id,account_id));create table clients(id uuid primary key,account_id uuid references accounts(id),unique(id,account_id));create table account_approver_events(id uuid,account_id uuid,profile_id uuid,new_revision integer,action text,unique(account_id,profile_id,new_revision,id));create table account_approver_state(account_id uuid,profile_id uuid,revision integer,last_event_id uuid,active boolean);`);await pg.exec('alter default privileges in schema public grant select,insert,update,delete on tables to aeo_app;');for(const name of ['076_enterprise_access.sql','077_enterprise_reports_workflows.sql'])await pg.exec(readFileSync('supabase/migrations/'+name,'utf8'));await pg.query('insert into accounts(id) values($1),($2)',[a,b]);await pg.query('insert into profiles(id,account_id,is_admin) values($1,$2,false),($3,$2,true),($4,$5,false)',[editor,a,reviewer,foreign,b]);await pg.query('insert into clients values($1,$2)',[c,a]);await pg.query("select enterprise_set_role($1,$2,$3,'manager',0,$4,'Fixture grant')",[a,reviewer,editor,request]);await pg.query("insert into enterprise_artifacts(id,account_id,client_id,kind,created_by,payload) values($1,$2,$3,'executive_report',$4,$5)",[artifact,a,c,editor,JSON.stringify({version:'executive-report.v1',technical:{score:80},retrieval:{status:'unavailable'},outcomes:{clicks:20},branding:{companyName:'Agency',primaryColor:'#AABBCC',logoUrl:null},locale:'en'})])})
afterAll(async()=>pg?.close())
const decide=(actor:string,account=a)=>pg.query<{result:string}>('select enterprise_decide($1,$2,$3,$4,$5,$6,$7) as result',[account,c,artifact,actor,'approved','Reviewed immutable evidence',request])
describe('immutable executive workflow SQL',()=>{
 it('requires existing active grant lineage and disallows author self-approval and foreign review',async()=>{
  expect((await decide(editor)).rows[0].result).toBe('DENIED');expect((await decide(foreign,b)).rows[0].result).toBe('NOT_FOUND')
  expect((await decide(reviewer)).rows[0].result).toBe('DENIED')
  await pg.query("insert into account_approver_events values($1,$2,$3,1,'grant')",[event,a,reviewer]);await pg.query('insert into account_approver_state values($1,$2,1,$3,true)',[a,reviewer,event])
  expect((await decide(reviewer)).rows[0].result).toBe('CREATED');expect((await decide(reviewer)).rows[0].result).toBe('REPLAYED')
 })
 it('publishes only owned approved hash, revokes and leaves content immutable',async()=>{
  const publish=(actor=editor,account=a)=>pg.query<{id:string}>('select id from enterprise_publish_portal($1,$2,$3,$4,$5)',[account,c,artifact,actor,'a'.repeat(32)])
  expect((await publish(foreign,b)).rows).toEqual([])
  const rows=(await publish()).rows;expect(rows).toHaveLength(1)
  expect((await pg.query('select content_hash from enterprise_portals')).rows).toEqual((await pg.query('select content_hash from enterprise_artifacts')).rows)
  await pg.exec('set role aeo_app');await expect(pg.query("update enterprise_artifacts set payload='{}' where id=$1",[artifact])).rejects.toThrow();await pg.exec('reset role')
  await pg.query('update enterprise_portals set revoked_at=now() where id=$1',[rows[0].id]);expect((await pg.query('select * from enterprise_portals where revoked_at is null')).rows).toHaveLength(0)
 })
})
