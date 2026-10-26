import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
export const ids={account:'11000000-0000-4000-8000-000000000001',foreign:'11000000-0000-4000-8000-000000000002',manager:'22000000-0000-4000-8000-000000000001',admin:'22000000-0000-4000-8000-000000000002',outsider:'22000000-0000-4000-8000-000000000003',client:'33000000-0000-4000-8000-000000000001',otherClient:'33000000-0000-4000-8000-000000000002',prompt:'44000000-0000-4000-8000-000000000001',request:'55000000-0000-4000-8000-000000000001'}
export async function enterpriseFixture(){const pg=await PGlite.create();await pg.exec(`
 create role aeo_app;create table accounts(id uuid primary key,plan text default 'enterprise',status text default 'active',stripe_subscription_id text default 'fixture',trial_ends_at timestamptz,override_plan text,override_expires_at timestamptz);
 create table profiles(id uuid primary key,account_id uuid references accounts(id),display_name text,is_admin boolean default false,deactivated_at timestamptz,unique(id,account_id));
 create table clients(id uuid primary key,account_id uuid references accounts(id),brand_name text default 'Brand',domain text default 'example.com',status text default 'active',unique(id,account_id));
 create table account_approver_events(id uuid,account_id uuid,profile_id uuid,new_revision integer,action text,unique(account_id,profile_id,new_revision,id));
 create table account_approver_state(account_id uuid,profile_id uuid,revision integer,last_event_id uuid,active boolean);
 create table prompt_bank(id uuid primary key,client_id uuid references clients(id),question text default 'Which service?',language text default 'en',market text default 'HK',is_active boolean default true,monitoring jsonb);
 create schema neon_auth;create table neon_auth."user"(id uuid primary key,email text);
 create table scans(id uuid primary key default gen_random_uuid(),account_id uuid,client_id uuid,score numeric,created_at timestamptz default now(),results jsonb);
 create table outcome_events(account_id uuid,client_id uuid,currency text,kind text,occurred_at timestamptz,sessions integer,conversions integer,revenue_minor bigint);
 create table google_connections(id uuid,account_id uuid,status text);
 create table search_console_bindings(account_id uuid,client_id uuid,connection_id uuid,site_url text,permission_level text,bound_domain text,backfill_pending boolean,bound_at timestamptz);
 create table search_console_daily(account_id uuid,client_id uuid,scope text,date date,synced_at timestamptz,clicks numeric,impressions numeric,position numeric);
 create table ai_observations(id uuid,account_id uuid,client_id uuid,finished_at timestamptz);
 `)
 for(const migration of ['076_enterprise_access.sql','077_enterprise_reports_workflows.sql','078_enterprise_delivery_adapters.sql'])await pg.exec(readFileSync('supabase/migrations/'+migration,'utf8'))
 await pg.exec('grant select on accounts,profiles,clients,prompt_bank,account_approver_events,account_approver_state,scans,outcome_events,google_connections,search_console_bindings,search_console_daily,ai_observations to aeo_app;grant update(status) on accounts to aeo_app;grant update(display_name) on profiles to aeo_app;grant update(active) on account_approver_state to aeo_app;grant usage on schema neon_auth to aeo_app;grant select on neon_auth."user" to aeo_app;')
 const i=ids;await pg.query('insert into accounts(id) values($1),($2)',[i.account,i.foreign]);await pg.query('insert into profiles(id,account_id,is_admin,display_name) values($1,$2,false,\'Manager\'),($3,$2,true,\'Reviewer\'),($4,$5,false,\'Outsider\')',[i.manager,i.account,i.admin,i.outsider,i.foreign]);await pg.query('insert into clients(id,account_id) values($1,$2),($3,$4)',[i.client,i.account,i.otherClient,i.foreign]);await pg.query('insert into neon_auth."user" values($1,$2),($3,$4)',[i.manager,'manager@example.com',i.admin,'reviewer@example.com']);await pg.query("select enterprise_set_role($1,$2,$3,'manager',0,$4,'Fixture manager')",[i.account,i.admin,i.manager,i.request]);await pg.query("insert into account_approver_events values($1,$2,$3,1,'grant')",[i.request,i.account,i.admin]);await pg.query('insert into account_approver_state values($1,$2,1,$3,true)',[i.account,i.admin,i.request]);await pg.query('insert into prompt_bank(id,client_id,monitoring) values($1,$2,$3)',[i.prompt,i.client,JSON.stringify({locale:'en',market:'HK',persona:'Buyer',intent:'comparison',funnel:'consideration',topic:'Services',targetUrl:'https://example.com/a',sampling:{temperature:0.2,samplesPerRun:1,seed:null}})])
 return pg
}
