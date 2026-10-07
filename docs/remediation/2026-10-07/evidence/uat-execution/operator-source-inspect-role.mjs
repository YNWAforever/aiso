import {readFileSync,writeFileSync} from 'node:fs'
import {Client,neonConfig} from '@neondatabase/serverless'
import {redactSecrets} from '../../../../../lib/security/redact-secrets.ts'
neonConfig.webSocketConstructor=globalThis.WebSocket
const out='artifacts/aiso/2026-10-07/uat-execution/retry-2'
const uri=readFileSync('.auth/aiso-uat-20261007/owner-uri.txt','utf8').trim()
const c=new Client({connectionString:uri,connectionTimeoutMillis:30000});c.on('error',()=>{})
try{
 await c.connect()
 await c.query('begin read only')
 const id=(await c.query(`select current_setting('neon.project_id',true) as project,current_setting('neon.branch_id',true) as branch,current_database() as database,current_user as role`)).rows[0]
 if(id.project!=='nameless-term-06793418'||id.branch!=='br-ancient-glitter-b34yew8s'||id.database!=='neondb'||id.role!=='neondb_owner')throw Error('Target identity mismatch')
 const tables=(await c.query(`select c.relname,has_table_privilege('aeo_app',c.oid,'SELECT') as can_select,has_table_privilege('aeo_app',c.oid,'INSERT') as can_insert,has_table_privilege('aeo_app',c.oid,'UPDATE') as can_update,has_table_privilege('aeo_app',c.oid,'DELETE') as can_delete from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') order by c.relname`)).rows
 const constrained=tables.filter(r=>['can_select','can_insert','can_update','can_delete'].some(p=>r[p]!==true))
 const role=(await c.query(`select rolcanlogin,rolbypassrls,rolcreatedb,rolcreaterole,rolsuper from pg_roles where rolname='aeo_app'`)).rows[0]
 await c.query('rollback')
 const result={observedAtUtc:new Date().toISOString(),identity:id,role,tables,constrained,exitCode:0,mutationPerformed:false}
 writeFileSync(out+'/role-inspection.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'})
 console.log(JSON.stringify({identity:id,tableCount:tables.length,constrained,role},null,2))
}catch(e){console.error(redactSecrets(String(e.message)));process.exitCode=1}finally{await c.end()}
