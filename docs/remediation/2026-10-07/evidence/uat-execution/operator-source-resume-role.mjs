import {readFileSync,writeFileSync} from 'node:fs'
import {createHash,randomBytes} from 'node:crypto'
import {Client,neonConfig} from '@neondatabase/serverless'
import {redactSecrets} from '../../../../../lib/security/redact-secrets.ts'
const out='artifacts/aiso/2026-10-07/uat-execution/retry-2'
const priv='.auth/aiso-uat-20261007'
const t=JSON.parse(readFileSync(out+'/target.json','utf8'))
const events=[];let discovered=0,pass=0,fail=0
const secrets=[]
const clean=s=>{for(const k of secrets)if(k)s=s.replaceAll(k,'[REDACTED]');return redactSecrets(s)}
const assert=(v,m)=>{discovered++;if(!v){fail++;throw Error(m)}pass++}
const save=(status,exitCode)=>writeFileSync(out+'/role-resumed.json',JSON.stringify({observedAtUtc:new Date().toISOString(),target:t,explanation:'Initial helper incorrectly required blanket CRUD. Checked-in expansion migrations intentionally restrict append-only/admin tables. No database grants changed; baseline/migrations were not replayed.',status,exitCode,counts:{discovered,pass,fail,skip:0},events},null,2)+'\n')
neonConfig.webSocketConstructor=globalThis.WebSocket
const id=async c=>(await c.query(`select current_setting('neon.project_id',true) as project,current_setting('neon.branch_id',true) as branch,current_database() as database,current_user as role`)).rows[0]
const guard=(v,role)=>assert(v.project===t.projectId&&v.branch===t.branchId&&v.database==='neondb'&&v.role===role,'Actual connection identity mismatch')
const client=uri=>{const c=new Client({connectionString:uri,connectionTimeoutMillis:30000});c.on('error',()=>{});return c}
let owner,app
try{
 const uri=readFileSync(priv+'/owner-uri.txt','utf8').trim();secrets.push(uri)
 const u=new URL(uri);secrets.push(decodeURIComponent(u.password))
 assert(t.projectId==='nameless-term-06793418'&&t.branchId==='br-ancient-glitter-b34yew8s'&&u.hostname===t.host&&u.username==='neondb_owner','Registered fresh target changed')
 for(const f of JSON.parse(readFileSync('artifacts/aiso/2026-10-07/uat-follow-up/follow-up-receipt.json','utf8')).reviewedInitializationSql) assert(createHash('sha256').update(readFileSync(f.path)).digest('hex')===f.sha256,'Reviewed SQL hash drift')
 const allowed={
  account_approver_events:'SELECT,INSERT',account_approver_state:'SELECT,INSERT,UPDATE',account_invitations:'SELECT,INSERT,UPDATE',
  client_asset_questions:'SELECT,INSERT,DELETE',client_assets:'SELECT,INSERT,UPDATE',client_domain_verifications:'SELECT,INSERT,UPDATE',client_entities:'SELECT,INSERT,UPDATE',
  client_source_versions:'SELECT,INSERT',client_sources:'SELECT,INSERT,UPDATE',evidence_work_items:'SELECT,INSERT,UPDATE',google_connections:'SELECT,INSERT,UPDATE',
  platform_admin_grants:'SELECT',pulse_classification_attempts:'SELECT,INSERT',pulse_item_attempts:'SELECT,INSERT',pulse_run_items:'SELECT,INSERT',pulse_runs:'SELECT,INSERT',
  scan_claim_attempts:'SELECT,INSERT',search_console_daily:'SELECT,INSERT,UPDATE',search_console_sync_runs:'SELECT,INSERT',work_item_decisions:'SELECT,INSERT',
  work_item_delivery_events:'SELECT,INSERT',work_item_export_events:'SELECT,INSERT',work_item_sources:'SELECT,INSERT,UPDATE',work_item_versions:'SELECT,INSERT'
 }
 owner=client(uri);await owner.connect();guard(await id(owner),'neondb_owner')
 const rows=(await owner.query(`select (select count(*) from accounts)::int as accounts,(select count(*) from profiles)::int as profiles,(select count(*) from clients)::int as clients,(select count(*) from scans)::int as scans,(select count(*) from neon_auth."user")::int as auth_users`)).rows[0]
 assert(Object.values(rows).every(v=>v===0),'Unexpected pre-login business or Auth data')
 const ledger=(await owner.query('select filename,checksum from schema_migrations order by filename')).rows
 assert(ledger.length===58&&ledger.find(r=>r.filename==='000_baseline_2026-08-31.sql')?.checksum==='d969357c1fefa3d657d73cc0b0ac5912c01dc029564820b0dfbd9060b39ddaf9','Final lineage mismatch')
 const role=(await owner.query(`select rolcanlogin,rolbypassrls,rolcreatedb,rolcreaterole,rolsuper from pg_roles where rolname='aeo_app'`)).rows[0]
 assert(role&&role.rolcanlogin&&role.rolbypassrls&&!role.rolcreatedb&&!role.rolcreaterole&&!role.rolsuper,'Fresh application role attributes changed')
 const password=randomBytes(32).toString('base64url');secrets.push(password)
 u.username='aeo_app';u.password=password;const appUri=u.toString();secrets.push(appUri)
 const runtime={DATABASE_URL:appUri,NEON_AUTH_BASE_URL:'https://ep-soft-bird-b3lqgjne.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth',NEON_AUTH_COOKIE_SECRET:randomBytes(32).toString('hex'),PUBLIC_SCAN_RATE_LIMIT_SECRET:randomBytes(32).toString('hex'),REPORT_SHARE_SECRET:randomBytes(32).toString('hex'),READINESS_PROBE_SECRET:randomBytes(32).toString('hex'),EXPECTED_NEON_PROJECT_ID:t.projectId,EXPECTED_NEON_BRANCH_ID:t.branchId,EXPECTED_DB_NAME:'neondb',EXPECTED_DB_ROLE:'aeo_app',FORBIDDEN_NEON_PROJECT_IDS:'weathered-wave-50814522,red-firefly-93523049',FORBIDDEN_NEON_BRANCH_IDS:'br-square-mountain-az6f82vi,br-hidden-hill-az61ux9z',FEATURE_SEARCH_CONSOLE:'false',FEATURE_PULSE_ATTEMPTS:'false',READINESS_EXPECTED_TEAM_ID:'team_qvzlsFmfCsLkgItSypqHjw3z'}
 writeFileSync(priv+'/runtime.json',JSON.stringify(runtime),{flag:'wx',mode:0o600})
 await owner.query("alter role aeo_app login password '"+password+"'")
 events.push({step:'new target aeo_app credential replaced after failed helper; no grants altered',businessRows:rows,ledgerRows:ledger.length,ownerCredentialInRuntime:false})
 app=client(appUri);await app.connect();const actual=await id(app);guard(actual,'aeo_app')
 const tables=(await app.query(`select c.relname,has_table_privilege(current_user,c.oid,'SELECT') as can_select,has_table_privilege(current_user,c.oid,'INSERT') as can_insert,has_table_privilege(current_user,c.oid,'UPDATE') as can_update,has_table_privilege(current_user,c.oid,'DELETE') as can_delete from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname`)).rows
 assert(tables.length===62,'Public relation inventory changed')
 for(const r of tables)for(const p of ['SELECT','INSERT','UPDATE','DELETE'])assert(r['can_'+p.toLowerCase()] === (allowed[r.relname]??'SELECT,INSERT,UPDATE,DELETE').split(',').includes(p),'Table permission mismatch '+r.relname+' '+p)
 const special=(await app.query(`select has_column_privilege(current_user,'public.client_source_versions','approved_by','UPDATE') as approval_actor,has_column_privilege(current_user,'public.client_source_versions','approved_at','UPDATE') as approval_time,has_column_privilege(current_user,'public.client_source_versions','id','UPDATE') as version_id,has_table_privilege(current_user,'neon_auth."user"','SELECT') as auth_read,has_table_privilege(current_user,'neon_auth."user"','INSERT') as auth_insert,has_table_privilege(current_user,'neon_auth."user"','UPDATE') as auth_update,has_table_privilege(current_user,'neon_auth."user"','DELETE') as auth_delete`)).rows[0]
 assert(special.approval_actor&&special.approval_time&&!special.version_id&&special.auth_read&&!special.auth_insert&&!special.auth_update&&!special.auth_delete,'Column approval / managed Auth privilege mismatch')
 const rpcs=['public.acquire_stripe_subscription_lease(text, uuid)','public.release_stripe_subscription_lease(text, uuid)','public.apply_stripe_account_event(uuid, text, text, text, text, bigint, text, text, uuid)','public.create_client_report_with_version(uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid)','public.append_client_report_version(uuid, uuid, uuid, uuid, uuid, text, text, integer, jsonb, uuid)','public.publish_client_report_latest(uuid, uuid, uuid, uuid)','public.revoke_client_report(uuid, uuid, uuid)','public.rotate_client_report_link(uuid, uuid, uuid)','public.increment_client_report_view(text, integer)','public.increment_client_report_cta_click(text, integer)']
 for(const rpc of rpcs)assert((await app.query("select has_function_privilege($1::text,'EXECUTE') as allowed",[rpc])).rows[0].allowed===true,'RPC privilege mismatch')
 assert((await app.query("select has_function_privilege('public.check_brand_limit()','EXECUTE') as allowed")).rows[0].allowed===false,'Trigger EXECUTE privilege widened')
 const denials=[['create table public.aiso_uat_ddl_denial_probe (id integer)','42501'],['drop table public.accounts','42501'],['alter table public.accounts add column aiso_uat_ddl_probe integer','42501'],['create role aiso_uat_role_denial_probe','42501']]
 for(const [sql,code] of denials){await app.query('begin');let actualCode=null;try{await app.query(sql)}catch(e){actualCode=e.code}finally{await app.query('rollback')}assert(actualCode===code,'DDL denial failed');events.push({step:'rolled-back application-role DDL denial',statement:sql,expectedCode:code,actualCode})}
 events.push({step:'actual aeo_app contract verified',identity:actual,tablesChecked:tables.length,privilegesChecked:tables.length*4,restrictedTables:Object.keys(allowed).length,rpcChecks:rpcs.length,columnAndAuthPrivileges:special,tenancyAcceptance:'Still requires real normal-session cross-tenant evidence'})
 save('pass',0);console.log(JSON.stringify({status:'pass',exitCode:0,counts:{discovered,pass,fail,skip:0},tablesChecked:62,rpcChecks:10,ddlDenials:4,grantsChanged:false}))
}catch(e){events.push({step:'role continuation stopped',error:clean(String(e.message)),code:e.code??null});save('blocked',1);console.error(clean(String(e.message)));process.exitCode=1}finally{await app?.end();await owner?.end()}
