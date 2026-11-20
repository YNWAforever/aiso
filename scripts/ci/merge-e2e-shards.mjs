import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkedOutSource } from './write-job-summary.mjs'

export function mergeE2EShards(shards, commitSha, treeSha = '') {
  const valid = (s) => s?.schemaVersion === 1 && s.job === 'e2e-accessibility'
    && s.commitSha === commitSha && Boolean(commitSha) && s.treeSha === treeSha
    && /^[0-9a-f]{40}$/.test(treeSha) && s.status === 'success'
    && Number.isInteger(s.executed) && s.executed > 0 && s.skipped === 0
    && Array.isArray(s.failurePriorities) && !s.failurePriorities.includes('P0')
    && Array.isArray(s.artifacts)
  const success = shards.length === 4 && shards.every(valid)
  return {
    schemaVersion: 1, job: 'e2e-accessibility', commitSha, treeSha,
    status: success ? 'success' : 'failure',
    executed: shards.reduce((n,s)=>n+(Number.isInteger(s?.executed) && s.executed > 0 ? s.executed : 0),0),
    skipped: shards.reduce((n,s)=>n+(Number.isInteger(s?.skipped) && s.skipped > 0 ? s.skipped : 0),0),
    failurePriorities: success ? [] : ['P0'],
    artifacts: [1,2,3,4].map(id=>`e2e-accessibility-${id}-summary.json`),
  }
}

export async function readE2EShards(directory) {
  return Promise.all([1,2,3,4].map(async id=>{
    const filename = `e2e-accessibility-${id}-summary.json`
    for(const path of [join(directory,filename),join(directory,'artifacts',filename)]) {
      try { return JSON.parse(await readFile(path,'utf8')) } catch { /* Missing evidence stays blocking. */ }
    }
    return null
  }))
}

async function main() {
  const { commitSha, treeSha } = checkedOutSource()
  const summary = mergeE2EShards(await readE2EShards('artifacts'), commitSha, treeSha)
  await mkdir('artifacts',{recursive:true})
  await writeFile('artifacts/e2e-accessibility-summary.json',JSON.stringify(summary,null,2)+'\n')
  // Always let aggregate-gate inspect the failure summary and dependency result.
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1})
}
