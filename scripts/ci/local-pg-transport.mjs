import pg from 'pg'
import {neonConfig} from '@neondatabase/serverless'
const pools=new Map()
const parseDsn=(dsn)=>{const u=new URL(dsn);if(u.hostname!=='127.0.0.1'||u.port!=='55439'||u.pathname!=='/aiso_audit_fixture'||!['fixture_owner','aeo_app'].includes(u.username))throw new Error('Local transport refuses non-fixture target');return u}
// The production db() binding guard and exact SQL remain intact; only HTTP transport is replaced by a real local PostgreSQL session.
// Text result mode matches the Neon HTTP protocol; this is local SQL evidence, never Neon service evidence.
neonConfig.fetchFunction=async(_url,options)=>{
 const dsn=options.headers['Neon-Connection-String'];const u=parseDsn(dsn)
 let pool=pools.get(u.username);if(!pool){pool=new pg.Pool({host:u.hostname,port:Number(u.port),user:u.username,database:u.pathname.slice(1),max:8});pools.set(u.username,pool)}
 const client=await pool.connect();const payload=JSON.parse(options.body),batch=Array.isArray(payload.queries)
 try{
  if(batch)await client.query('begin')
  const results=[]
  for(const statement of batch?payload.queries:[payload]){const result=await client.query({text:statement.query,values:statement.params,rowMode:'array',types:{getTypeParser:()=>value=>value}});results.push({command:result.command,rowCount:result.rowCount,fields:result.fields.map(field=>({name:field.name,dataTypeID:field.dataTypeID})),rows:result.rows})}
  if(batch)await client.query('commit')
  return new Response(JSON.stringify(batch?{results}:results[0]),{status:200})
 }catch(error){if(batch)await client.query('rollback');return new Response(JSON.stringify({message:error.message,code:error.code,detail:error.detail}),{status:400})}finally{client.release()}
}
globalThis.fetch=()=>{throw new Error('Local persistence suite denies all external HTTP')}
export async function closeLocalTransport(){for(const pool of pools.values())await pool.end()}
