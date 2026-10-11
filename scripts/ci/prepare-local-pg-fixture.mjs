import {execFileSync} from 'node:child_process'
import {readFileSync,readdirSync} from 'node:fs'
import pg from 'pg'
const container='aiso-audit-20261011-pg'
const metadata=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0]
if(metadata.Config.Labels?.['codex.task']!=='aiso-audit-20261011'||metadata.NetworkSettings.Ports['5432/tcp']?.[0]?.HostIp!=='127.0.0.1'||metadata.NetworkSettings.Ports['5432/tcp']?.[0]?.HostPort!=='55439')throw new Error('Fixture container identity mismatch')
const client=new pg.Client({host:'127.0.0.1',port:55439,user:'fixture_owner',database:'aiso_audit_fixture'});await client.connect()
try{
 const {rows:[identity]}=await client.query("select current_database() as db,current_setting('neon.project_id') as project,current_setting('neon.branch_id') as branch")
 if(identity.db!=='aiso_audit_fixture'||identity.project!=='local-aiso-audit-fixture'||identity.branch!=='local-20261011-isolated')throw new Error('Local fixture identity mismatch')
 await client.query("create schema if not exists auth;create table if not exists auth.users(id uuid primary key);create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;create schema if not exists neon_auth;create table if not exists neon_auth.user(id uuid primary key,email text,name text,created_at timestamptz default now());create table if not exists fixture_migrations(name text primary key)")
 for(const file of readdirSync('supabase/migrations').filter(x=>x.endsWith('.sql')).sort()){
  if((await client.query('select name from fixture_migrations where name=$1',[file])).rowCount)continue
  await client.query('begin')
  try{await client.query(readFileSync('supabase/migrations/'+file,'utf8'));await client.query('insert into fixture_migrations values($1)',[file]);await client.query('commit');console.log('applied '+file)}catch(e){await client.query('rollback');throw new Error('Migration '+file+': '+e.message)}
 }
 // Synthetic role on this independently verified local-only fixture. No remote role change.
 await client.query('alter role aeo_app login')
 if(process.argv.includes('--reset-fixture-data'))await client.query('truncate accounts cascade')
 console.log('LOCAL_POSTGRES_FIXTURE_READY (not Neon or hosted evidence)')
}finally{await client.end()}
