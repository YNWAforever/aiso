import {spawnSync} from 'node:child_process'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {provisionBranch,teardown} from '../../__tests__/integration/setup.ts'
import {PROJECT_ID} from '../../__tests__/helpers/neon-branch.ts'
import {redactSecrets} from '../../lib/security/redact-secrets.ts'

// Owner fixture evidence only. Never substitutes for aeo_app execution or UAT.
// These configs require no application-role password or role modification.
const configs=['entity','work-items','first-run-journey','feature-store-tenancy','reports-entities-tenancy','alerts-agents-tenancy','search-console']
const directory='artifacts/aiso/T17/owner-suites'
mkdirSync(directory,{recursive:true})
let failed=false,total=0
try{
 const branch=await provisionBranch()
 const env={...process.env,TEST_DATABASE_URL:branch.connectionUri,
  C9_ENTITY_DISPOSABLE_BRANCH_ID:branch.id,C9_ENTITY_PROJECT_ID:PROJECT_ID,C9_ENTITY_OWNER_ROLE:'neondb_owner',
  C9C_WORK_ITEMS_DISPOSABLE_BRANCH_ID:branch.id,C9C_WORK_ITEMS_PROJECT_ID:PROJECT_ID,C9C_WORK_ITEMS_OWNER_ROLE:'neondb_owner',
  C9F_TENANCY_DISPOSABLE_BRANCH_ID:branch.id,C9F_TENANCY_PROJECT_ID:PROJECT_ID,C9F_TENANCY_OWNER_ROLE:'neondb_owner'}
 for(const action of ['--verify','--dry-run']){
  const check=spawnSync(process.execPath,['scripts/migrate.ts',action],{env:{...env,MIGRATE_DATABASE_URL:branch.connectionUri},encoding:'utf8',shell:false})
  writeFileSync(`${directory}/migration${action}.log`,redactSecrets((check.stdout??'')+(check.stderr??'')))
  if(check.status!==0)throw new Error(`Disposable schema ${action} failed`)
 }
 for(const name of configs){
  const report=`${directory}/${name}.json`
  const run=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config',`vitest.${name}-integration.config.ts`,'--reporter=json',`--outputFile=${report}`],{env,encoding:'utf8',shell:false})
  writeFileSync(`${directory}/${name}.log`,redactSecrets((run.stdout??'')+(run.stderr??'')))
  const raw=redactSecrets(readFileSync(report,'utf8'));writeFileSync(report,raw)
  const result=JSON.parse(raw),count=result.numPassedTests??0
  const passed=run.status===0&&count>0&&(result.numPendingTests??0)===0&&(result.numFailedTests??0)===0
  failed||=!passed;total+=count
  process.stdout.write(`${name}: ${passed?'pass':'FAIL'}, ${count} passed, ${result.numPendingTests??0} skipped\n`)
 }
 process.stdout.write(`Owner fixtures: ${total} passed; actual role execution remains blocked\n`)
}finally{await teardown()}
process.exitCode=failed?1:0
